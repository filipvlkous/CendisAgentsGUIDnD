// Reads and writes Claude Code agents (<scope>/agents/*.md) and skills (<scope>/skills/<dir>/SKILL.md).
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentDoc, Scope, SkillDoc } from "../shared/types.ts";
import { parseFrontmatter, str, stringifyFrontmatter } from "./frontmatter.ts";
import { assertSafeId, backup, getScope, getScopes, HttpError } from "./store.ts";

const AGENT_KEYS = ["name", "description", "model", "effort", "color", "tools", "skills"] as const;
const SKILL_KEYS = ["name", "description"] as const;

async function listDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
}

function pickExtra(data: Record<string, unknown>, known: readonly string[]) {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !known.includes(k)));
}

// ---------- agents ----------

async function readAgent(scope: Scope, file: string): Promise<AgentDoc> {
  const p = path.join(scope.dir, "agents", `${file}.md`);
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    throw new HttpError(404, `Agent "${file}" not found in ${scope.label}`);
  }
  const { data, body } = parseFrontmatter(text);
  return {
    scope: scope.id,
    file,
    name: str(data.name) ?? file,
    description: str(data.description) ?? "",
    model: str(data.model),
    effort: str(data.effort),
    color: str(data.color),
    tools: str(data.tools),
    skills: list(data.skills),
    extra: pickExtra(data, AGENT_KEYS),
    body,
    path: p,
  };
}

export async function listAgents(): Promise<AgentDoc[]> {
  const out: AgentDoc[] = [];
  for (const scope of await getScopes()) {
    for (const entry of await listDir(path.join(scope.dir, "agents"))) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(await readAgent(scope, entry.name.slice(0, -3)));
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAgent(scopeId: string, file: string) {
  return readAgent(await getScope(scopeId), assertSafeId(file, "agent file"));
}

export async function saveAgent(scopeId: string, file: string, doc: AgentDoc): Promise<AgentDoc> {
  const scope = await getScope(scopeId);
  assertSafeId(file, "agent file");
  if (!doc.name.trim()) throw new HttpError(400, "Agent name is required");
  if (!doc.description.trim()) throw new HttpError(400, "Agent description is required");
  const p = path.join(scope.dir, "agents", `${file}.md`);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await backup(p);
  const data = {
    name: doc.name.trim(),
    description: doc.description.trim(),
    model: doc.model,
    effort: doc.effort,
    color: doc.color,
    tools: doc.tools?.trim(),
    skills: doc.skills?.length ? doc.skills : undefined,
    ...doc.extra,
  };
  await fs.writeFile(p, stringifyFrontmatter(data, doc.body));
  return readAgent(scope, file);
}

export async function deleteAgent(scopeId: string, file: string) {
  const scope = await getScope(scopeId);
  const p = path.join(scope.dir, "agents", `${assertSafeId(file, "agent file")}.md`);
  await backup(p);
  await fs.rm(p, { force: true });
}

// ---------- skills ----------

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await listDir(path.join(root, rel))) {
    const r = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(root, r)));
    else if (r !== "SKILL.md") out.push(r);
  }
  return out;
}

async function readSkill(scope: Scope, dir: string): Promise<SkillDoc | null> {
  const root = path.join(scope.dir, "skills", dir);
  const p = path.join(root, "SKILL.md");
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(text);
  return {
    scope: scope.id,
    dir,
    name: str(data.name) ?? dir,
    description: str(data.description) ?? "",
    extra: pickExtra(data, SKILL_KEYS),
    body,
    files: (await walk(root)).sort(),
    path: p,
  };
}

export async function listSkills(): Promise<SkillDoc[]> {
  const out: SkillDoc[] = [];
  for (const scope of await getScopes()) {
    for (const entry of await listDir(path.join(scope.dir, "skills"))) {
      // Symlinked skill directories are common (e.g. ~/.agents/skills); readSkill skips anything without SKILL.md.
      if (entry.name.startsWith(".") || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      const skill = await readSkill(scope, entry.name);
      if (skill) out.push(skill);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkill(scopeId: string, dir: string) {
  const skill = await readSkill(await getScope(scopeId), assertSafeId(dir, "skill directory"));
  if (!skill) throw new HttpError(404, `Skill "${dir}" not found`);
  return skill;
}

export async function saveSkill(scopeId: string, dir: string, doc: SkillDoc): Promise<SkillDoc> {
  const scope = await getScope(scopeId);
  assertSafeId(dir, "skill directory");
  if (!doc.name.trim()) throw new HttpError(400, "Skill name is required");
  if (!doc.description.trim()) throw new HttpError(400, "Skill description is required");
  const p = path.join(scope.dir, "skills", dir, "SKILL.md");
  await fs.mkdir(path.dirname(p), { recursive: true });
  await backup(p);
  const data = { name: doc.name.trim(), description: doc.description.trim(), ...doc.extra };
  await fs.writeFile(p, stringifyFrontmatter(data, doc.body));
  return (await readSkill(scope, dir))!;
}

export async function deleteSkill(scopeId: string, dir: string) {
  const scope = await getScope(scopeId);
  const root = path.join(scope.dir, "skills", assertSafeId(dir, "skill directory"));
  await backup(root);
  await fs.rm(root, { recursive: true, force: true });
}

/** Reads one supporting file of a skill (scripts, references) for display. */
export async function readSkillFile(scopeId: string, dir: string, rel: string): Promise<string> {
  const scope = await getScope(scopeId);
  const root = path.join(scope.dir, "skills", assertSafeId(dir, "skill directory"));
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep)) throw new HttpError(400, "Path escapes the skill directory");
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) throw new HttpError(404, "File not found");
  if (stat.size > 512_000) return `(${stat.size} bytes — too large to preview)`;
  return fs.readFile(target, "utf8");
}
