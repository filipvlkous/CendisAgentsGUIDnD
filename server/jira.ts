// Your Jira issues as quests. Same rules as the jira-workflow skill and tools/jira-lib.sh:
// credentials from a .loc.env, /myself checked first (unauthenticated searches return an empty 200),
// retries on 429/5xx/timeouts. The token stays on this server — the browser only gets quest data.
import fs from "node:fs/promises";
import type { JiraQuest, QuestDetail, QuestLog } from "../shared/types.ts";
import { getSettings, HttpError } from "./store.ts";

interface Creds {
  domain: string;
  auth: string;
}

async function creds(): Promise<Creds> {
  const { jiraEnvFile } = await getSettings();
  if (!jiraEnvFile) throw new HttpError(412, "no-credentials — set the Jira credentials file (.loc.env) in Settings");
  let text: string;
  try {
    text = await fs.readFile(jiraEnvFile, "utf8");
  } catch {
    throw new HttpError(412, `no-credentials — cannot read ${jiraEnvFile}`);
  }
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  for (const k of ["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"]) {
    if (!env[k]) throw new HttpError(412, `no-credentials — ${k} is empty in ${jiraEnvFile}`);
  }
  return {
    domain: env.JIRA_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    auth: "Basic " + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64"),
  };
}

async function jiraFetch<T>(c: Creds, path: string, init?: RequestInit): Promise<T> {
  let last = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://${c.domain}${path}`, {
        ...init,
        headers: { Authorization: c.auth, Accept: "application/json", "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      last = `network error: ${(e as Error).message}`;
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as { errorMessages?: string[] };
    last = `HTTP ${res.status}${body.errorMessages?.length ? `: ${body.errorMessages.join("; ")}` : ""}`;
    if ((res.status === 401 || res.status === 403) && path.startsWith("/rest/api/3/myself"))
      throw new HttpError(401, `invalid-credentials — Jira rejected the token (${last})`);
    if (res.status !== 429 && res.status < 500) break;
    if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new HttpError(502, `jira-error — ${last} on ${path.split("?")[0]}`);
}

const DIFFICULTY: Record<string, number> = {
  nejvyšší: 5, highest: 5, blocker: 5, kritická: 5,
  vysoká: 4, high: 4, major: 4,
  střední: 3, medium: 3,
  nižší: 2, low: 2, minor: 2,
  nejnižší: 1, lowest: 1, trivial: 1,
};

const FIELDS = "summary,status,issuetype,priority,updated,parent,project,duedate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toQuest(c: Creds, i: any): JiraQuest {
  const f = i.fields;
  const priority = f.priority?.name ?? "—";
  return {
    key: i.key,
    url: `https://${c.domain}/browse/${i.key}`,
    summary: f.summary,
    status: f.status?.name ?? "?",
    category: f.status?.statusCategory?.key ?? "new",
    type: f.issuetype?.name ?? "Task",
    priority,
    difficulty: DIFFICULTY[priority.toLowerCase()] ?? 3,
    project: f.project?.name ?? "",
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary ?? "" } : undefined,
    updated: f.updated,
    due: f.duedate ?? undefined,
  };
}

let cache: { at: number; log: QuestLog } | null = null;

/** Unresolved issues assigned to you — exactly Jira's "Assigned to me" tab. Cached for a minute. */
export async function questLog(force = false): Promise<QuestLog> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.log;
  const c = await creds();
  const me = await jiraFetch<{ displayName: string; avatarUrls?: Record<string, string> }>(c, "/rest/api/3/myself");

  const quests: JiraQuest[] = [];
  let token: string | undefined;
  do {
    const q = new URLSearchParams({
      jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
      fields: FIELDS,
      maxResults: "100",
    });
    if (token) q.set("nextPageToken", token);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await jiraFetch<{ issues: any[]; nextPageToken?: string }>(c, `/rest/api/3/search/jql?${q}`);
    quests.push(...page.issues.map((i) => toQuest(c, i)));
    token = page.nextPageToken; // more pages exactly when a token comes back
  } while (token);

  // Completed quests set the player's level; a failure here must not hide the quest list.
  const completed = await jiraFetch<{ count: number }>(c, "/rest/api/3/search/approximate-count", {
    method: "POST",
    body: JSON.stringify({ jql: "assignee = currentUser() AND statusCategory = Done" }),
  })
    .then((r) => r.count)
    .catch(() => null);

  const log: QuestLog = { player: { name: me.displayName, avatar: me.avatarUrls?.["48x48"] }, quests, completed, fetchedAt: Date.now() };
  cache = { at: Date.now(), log };
  return log;
}

// ---------- one quest in full ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Adf = any;

/** ADF → text, keeping paragraphs and list items apart and marking images where they sit. */
function adfText(node: Adf): string {
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) return node.map(adfText).join("");
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "mention":
      return node.attrs?.text ?? "@someone";
    case "emoji":
      return node.attrs?.text ?? "";
    case "inlineCard":
    case "blockCard":
      return node.attrs?.url ?? "";
    case "media":
    case "mediaInline":
      return `[[image: ${node.attrs?.alt ?? node.attrs?.id ?? "?"}]]`;
    case "listItem":
      return "• " + adfText(node.content).trim() + "\n";
    case "paragraph":
    case "heading":
    case "blockquote":
    case "codeBlock":
    case "mediaSingle":
    case "mediaGroup":
    case "rule":
    case "panel":
      return adfText(node.content).trim() + "\n\n";
    case "tableRow":
      return (node.content ?? []).map((cell: Adf) => adfText(cell.content).trim()).join(" | ") + "\n";
    default:
      return adfText(node.content);
  }
}

function adfLinks(node: Adf, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((n) => adfLinks(n, out));
    return out;
  }
  for (const u of [node.attrs?.url, node.attrs?.href, ...(node.marks ?? []).map((m: Adf) => m.attrs?.href)]) if (u) out.add(u);
  if (typeof node.text === "string") for (const m of node.text.matchAll(/https?:\/\/[^\s)\]]+/g)) out.add(m[0]);
  adfLinks(node.content, out);
  return out;
}

export async function questDetail(key: string): Promise<QuestDetail> {
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) throw new HttpError(400, `no-key — "${key}" is not an issue key`);
  const c = await creds();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issue = await jiraFetch<any>(c, `/rest/api/3/issue/${key}?fields=${FIELDS},description,reporter,attachment`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comments: any[] = [];
  for (let start = 0; ; ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await jiraFetch<{ comments: any[]; total: number }>(
      c,
      `/rest/api/3/issue/${key}/comment?orderBy=created&startAt=${start}&maxResults=100`,
    );
    comments.push(...page.comments);
    start += page.comments.length;
    if (!page.comments.length || start >= page.total) break;
  }
  const links = adfLinks(issue.fields.description);
  comments.forEach((cm) => adfLinks(cm.body, links));
  return {
    ...toQuest(c, issue),
    reporter: issue.fields.reporter?.displayName ?? "—",
    description: adfText(issue.fields.description).replace(/\n{3,}/g, "\n\n").trim(),
    comments: comments.map((cm) => ({
      author: cm.author?.displayName ?? "?",
      created: cm.created,
      edited: cm.updated !== cm.created,
      text: adfText(cm.body).replace(/\n{3,}/g, "\n\n").trim(),
    })),
    links: [...links],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    images: (issue.fields.attachment ?? []).filter((a: any) => a.mimeType?.startsWith("image/")).map((a: any) => a.filename),
  };
}
