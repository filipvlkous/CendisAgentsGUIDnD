// Executes workflows as a DAG of `claude -p` processes and streams progress to subscribers.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  Denial,
  PermissionMode,
  Run,
  RunMessage,
  RunSummary,
  StepEvent,
  StepRun,
  WorkflowStep,
} from "../shared/types.ts";
import { db } from "./db.ts";
import { expandHome, getSettings, HttpError } from "./store.ts";
import { validateSteps } from "./workflows.ts";

const MAX_EVENTS_PER_STEP = 2000;

/** Appended to every hero's system prompt: when blocked, ask instead of guessing or giving up. */
const ASK_WHEN_BLOCKED = `You are running unattended inside an Agent Guild campaign, so nobody can answer you mid-run.
If you get blocked — a tool or command is denied, information is missing, the request is ambiguous, or going on
would need a decision you should not make alone — do not guess and do not work around the block. Finish what you
safely can, then end your final reply with one line per question, each starting with "QUESTION:". Make each
question specific and answerable, and offer options where you can, e.g.
QUESTION: The ticket says POST /cancel but the backend comment says DELETE /requests/{id} — which one should I call?
If a permission was denied, name the exact command or tool you need. The user will answer and you will continue in
this same session. When you are not blocked, do not write any QUESTION: lines.`;

export function extractQuestions(text = ""): string[] {
  return text
    .split("\n")
    .map((l) => /^\s*(?:[-*>]\s*)?(?:\*\*)?QUESTION:(?:\*\*)?\s*(.+)$/i.exec(l)?.[1]?.trim())
    .filter((q): q is string => !!q);
}

/**
 * The narrowest allow rules that would have let a refused call through. A chained shell command
 * (`mkdir -p out && touch out/x`) needs one rule per command, so all of them are suggested at once.
 */
export function rulesFor(tool: string, input: Record<string, unknown> = {}): string[] {
  if (tool === "Bash" && typeof input.command === "string") {
    const multi = ["git", "npm", "npx", "yarn", "pnpm", "docker", "gh", "kubectl"];
    const rules = input.command
      .split(/&&|\|\||;|\||\n/)
      .map((part) => part.trim().replace(/^(?:\w+=\S*\s+)+/, "").split(/\s+/)) // drop leading VAR=value
      .filter((words) => words[0])
      .map((words) => {
        const prefix = multi.includes(words[0]) && words[1] && !words[1].startsWith("-") ? words.slice(0, 2) : words.slice(0, 1);
        return `Bash(${prefix.join(" ")} *)`;
      });
    return [...new Set(rules)];
  }
  if ((tool === "WebFetch" || tool === "WebSearch") && typeof input.url === "string") {
    try {
      return [`WebFetch(domain:${new URL(input.url).hostname})`];
    } catch {
      return [tool];
    }
  }
  return [tool];
}

interface Live {
  run: Run;
  listeners: Set<(msg: RunMessage) => void>;
  children: Map<string, ChildProcess>;
  saveTimer?: NodeJS.Timeout;
  saving: Promise<void>;
}

const live = new Map<string, Live>();

export interface StartOptions {
  workflowId: string | null;
  workflowName: string;
  steps: WorkflowStep[];
  input: string;
  cwd: string;
  permissionMode: PermissionMode;
  allowedTools?: string;
  questKey?: string;
}

export async function startRun(opts: StartOptions): Promise<Run> {
  validateSteps(opts.steps);
  const cwd = path.resolve(expandHome(opts.cwd.trim()) || process.cwd());
  const stat = await fs.stat(cwd).catch(() => null);
  if (!stat?.isDirectory()) throw new HttpError(400, `Working directory does not exist: ${cwd}`);

  const run: Run = {
    id: `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${randomUUID().slice(0, 6)}`,
    workflowId: opts.workflowId,
    workflowName: opts.workflowName,
    input: opts.input,
    cwd,
    status: "running",
    steps: opts.steps,
    stepRuns: Object.fromEntries(opts.steps.map((s) => [s.id, { status: "pending", events: [] } as StepRun])),
    startedAt: Date.now(),
    permissionMode: opts.permissionMode,
    allowedTools: splitRules(opts.allowedTools),
    questKey: opts.questKey,
  };
  const l: Live = { run, listeners: new Set(), children: new Map(), saving: Promise.resolve() };
  live.set(run.id, l);
  await persist(l);
  void schedule(l);
  return run;
}

/** Splits "Bash(git log:*), Read" on commas outside parentheses. */
export function splitRules(rules = ""): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of rules) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if ((ch === "," || ch === "\n") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function emit(l: Live, msg: RunMessage) {
  for (const fn of l.listeners) fn(msg);
  if (!l.saveTimer) {
    l.saveTimer = setTimeout(() => {
      l.saveTimer = undefined;
      void persist(l);
    }, 1000);
  }
}

function saveRun(run: Run) {
  db.prepare(
    `INSERT INTO runs (id, started_at, status, data) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status, data = excluded.data`,
  ).run(run.id, run.startedAt, run.status, JSON.stringify(run));
}

/** Writes are chained per run so a slow write never lands after a newer one. */
function persist(l: Live): Promise<void> {
  l.saving = l.saving
    .then(() => saveRun(l.run))
    .catch((err) => console.error(`Could not save run ${l.run.id}:`, err));
  return l.saving;
}

function patchStep(l: Live, stepId: string, patch: Partial<StepRun>) {
  Object.assign(l.run.stepRuns[stepId], patch);
  emit(l, { type: "step", stepId, patch });
}

function pushEvent(l: Live, stepId: string, event: StepEvent) {
  const events = l.run.stepRuns[stepId].events;
  if (events.length >= MAX_EVENTS_PER_STEP) events.splice(0, 1);
  events.push(event);
  emit(l, { type: "event", stepId, event });
}

function setRunStatus(l: Live, status: Run["status"]) {
  if (l.run.status === status) return;
  l.run.status = status;
  emit(l, { type: "status", status });
}

/** Starts every step whose dependencies are done; re-runs whenever a step finishes. */
async function schedule(l: Live) {
  const { run } = l;
  if (run.status !== "running") return;

  for (const step of run.steps) {
    const sr = run.stepRuns[step.id];
    if (sr.status !== "pending") continue;
    const deps = step.dependsOn.map((d) => run.stepRuns[d].status);
    if (deps.some((s) => s === "failed" || s === "skipped" || s === "cancelled")) {
      patchStep(l, step.id, { status: "skipped", finishedAt: Date.now() });
      continue;
    }
    if (deps.every((s) => s === "done")) {
      // Mark running synchronously so a concurrent schedule() pass cannot start it twice.
      patchStep(l, step.id, { status: "running", startedAt: Date.now() });
      void execStep(l, step).then(() => schedule(l));
    }
  }

  const statuses = Object.values(run.stepRuns).map((s) => s.status);
  if (statuses.includes("running")) return;
  // Someone is blocked: pause the run (stages after it stay pending) until you answer.
  if (statuses.includes("waiting")) {
    setRunStatus(l, "waiting");
    void persist(l);
    return;
  }
  if (statuses.includes("pending")) return;
  finish(l, statuses.every((s) => s === "done") ? "done" : "failed");
}

function finish(l: Live, status: Run["status"]) {
  if (l.run.status !== "running" && l.run.status !== "waiting") return;
  l.run.status = status;
  l.run.finishedAt = Date.now();
  emit(l, { type: "status", status, finishedAt: l.run.finishedAt });
  clearTimeout(l.saveTimer);
  l.saveTimer = undefined;
  void persist(l).then(() => {
    // Keep finished runs in memory briefly so late subscribers get the final snapshot.
    setTimeout(() => live.delete(l.run.id), 60_000);
  });
}

export function renderPrompt(template: string, run: Run): string {
  return template
    .replace(/\{\{\s*input\s*\}\}/g, run.input)
    .replace(/\{\{\s*steps\.([\w-]+)\.output\s*\}\}/g, (_, id: string) => run.stepRuns[id]?.output ?? `(no output from ${id})`);
}

/** Runs a stage's first turn, or — with `resume` — continues its session with your answer. */
async function execStep(l: Live, step: WorkflowStep, resume?: { sessionId: string; message: string }): Promise<void> {
  const { claudePath } = await getSettings();
  if (l.run.stepRuns[step.id].status === "cancelled") return;
  const prompt = resume ? resume.message : renderPrompt(step.prompt, l.run);
  if (!resume) patchStep(l, step.id, { prompt });
  const priorCost = l.run.stepRuns[step.id].costUsd ?? 0;

  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", l.run.permissionMode ?? "acceptEdits"];
  args.push("--append-system-prompt", ASK_WHEN_BLOCKED);
  if (resume) args.push("--resume", resume.sessionId);
  if (step.agent) args.push("--agent", step.agent);
  if (step.model) args.push("--model", step.model);
  const rules = [...(l.run.allowedTools ?? []), ...(l.run.stepRuns[step.id].allowed ?? [])];
  // Variadic flag: keep it last so it cannot swallow other arguments.
  if (rules.length) args.push("--allowedTools", ...rules);

  const shown = args.map((a) => (a === ASK_WHEN_BLOCKED ? "<ask-when-blocked>" : a));
  pushEvent(l, step.id, { kind: "log", text: `$ claude ${shown.join(" ")}  (cwd: ${l.run.cwd})`, at: Date.now() });

  await new Promise<void>((resolve) => {
    const child = spawn(claudePath, args, { cwd: l.run.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    l.children.set(step.id, child);
    child.stdin.end(prompt);

    let buf = "";
    let stderr = "";
    let result: { text?: string; isError?: boolean; cost?: number; sessionId?: string; denials?: Denial[] } = {};

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) result = { ...result, ...handleLine(l, step.id, line) };
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      pushEvent(l, step.id, { kind: "log", text: chunk.trimEnd(), at: Date.now() });
    });

    const done = (code: number | null, spawnError?: Error) => {
      l.children.delete(step.id);
      const sr = l.run.stepRuns[step.id];
      if (sr.status === "cancelled") return resolve();
      const ok = !spawnError && code === 0 && !result.isError;
      const questions = extractQuestions(result.text);
      const denials = result.denials ?? [];
      // Blocked = it asked something, or a tool was refused. Either way it waits for you, not fails.
      const blocked = !spawnError && !!(result.sessionId ?? sr.sessionId) && (questions.length > 0 || denials.length > 0);
      if (denials.length && !questions.length)
        questions.push(`I was not allowed to use: ${denials.map((d) => d.rule).join(", ")}. May I?`);
      patchStep(l, step.id, {
        status: blocked ? "waiting" : ok ? "done" : "failed",
        output: result.text ?? sr.output,
        costUsd: priorCost + (result.cost ?? 0),
        sessionId: result.sessionId ?? sr.sessionId,
        questions: blocked ? questions : [],
        denials: blocked ? denials : [],
        error: ok || blocked
          ? undefined
          : spawnError
            ? `Could not start "${claudePath}": ${spawnError.message}. Set the Claude CLI path in Settings.`
            : result.isError
              ? result.text || "The agent reported an error"
              : `claude exited with code ${code}${stderr ? `: ${stderr.trim().slice(-500)}` : ""}`,
        finishedAt: Date.now(),
      });
      resolve();
    };
    child.on("error", (err) => done(null, err));
    child.on("close", (code) => done(code));
  });
}

type ContentBlock = { type: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean };

function handleLine(l: Live, stepId: string, line: string) {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    pushEvent(l, stepId, { kind: "log", text: line, at: Date.now() });
    return {};
  }
  const at = Date.now();
  const nested = msg.parent_tool_use_id ? "↳ " : "";
  if (msg.type === "system" && msg.subtype === "init") {
    pushEvent(l, stepId, { kind: "log", text: `session ${msg.session_id} · model ${msg.model ?? "?"}`, at });
    return { sessionId: msg.session_id as string };
  }
  if (msg.type === "assistant") {
    for (const block of (msg.message?.content ?? []) as ContentBlock[]) {
      if (block.type === "text" && block.text?.trim()) pushEvent(l, stepId, { kind: "text", text: nested + block.text, at });
      if (block.type === "tool_use")
        pushEvent(l, stepId, { kind: "tool", name: nested + block.name, input: summarize(block.input), at });
    }
  }
  if (msg.type === "user") {
    for (const block of (msg.message?.content ?? []) as ContentBlock[]) {
      if (block.type === "tool_result")
        pushEvent(l, stepId, { kind: "tool_result", text: nested + toText(block.content).slice(0, 4000), isError: !!block.is_error, at });
    }
  }
  if (msg.type === "result") {
    const denials: Denial[] = (Array.isArray(msg.permission_denials) ? msg.permission_denials : []).flatMap(
      (d: { tool_name: string; tool_input?: Record<string, unknown> }) =>
        rulesFor(d.tool_name, d.tool_input).map((rule) => ({ tool: d.tool_name, input: summarize(d.tool_input), rule })),
    );
    return {
      text: typeof msg.result === "string" ? msg.result : undefined,
      isError: !!msg.is_error || (msg.subtype && msg.subtype !== "success"),
      cost: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
      sessionId: msg.session_id as string,
      // the same rule refused twice is one question
      denials: [...new Map(denials.map((d) => [d.rule, d])).values()],
    };
  }
  return {};
}

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((c) => (c?.type === "text" ? c.text : `[${c?.type ?? "content"}]`)).join("\n");
  return JSON.stringify(content);
}

function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return String(input ?? "");
  const o = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "pattern", "url", "description", "prompt", "skill"]) {
    if (typeof o[key] === "string") return `${o[key]}`.slice(0, 300);
  }
  return JSON.stringify(input).slice(0, 300);
}

/** A waiting run may only exist on disk (server restarted); bring it back to life to resume it. */
async function ensureLive(id: string): Promise<Live> {
  const existing = live.get(id);
  if (existing) return existing;
  const run = await getRun(id);
  const l: Live = { run, listeners: new Set(), children: new Map(), saving: Promise.resolve() };
  live.set(id, l);
  return l;
}

/** Your answer to a blocked stage: grant rules and/or reply, then the hero continues the same session. */
export async function answerStep(runId: string, stepId: string, body: { answer?: string; allow?: string[] }) {
  const l = await ensureLive(runId);
  const step = l.run.steps.find((s) => s.id === stepId);
  const sr = l.run.stepRuns[stepId];
  if (!step || !sr) throw new HttpError(404, "Stage not found");
  if (sr.status !== "waiting") throw new HttpError(409, "This stage is not waiting for an answer");
  if (!sr.sessionId) throw new HttpError(409, "No session to resume");
  const answer = (body.answer ?? "").trim();
  const allow = (body.allow ?? []).map((r) => r.trim()).filter(Boolean);
  if (!answer && !allow.length) throw new HttpError(400, "Write an answer or allow something");

  const parts: string[] = [];
  if (allow.length) parts.push(`You now have permission to use: ${allow.join(", ")}. Retry what was blocked.`);
  if (answer) parts.push(`Answer from the user:\n${answer}`);
  parts.push("Continue the task from where you stopped. If you are still blocked, ask again with QUESTION: lines.");
  const message = parts.join("\n\n");

  pushEvent(l, stepId, { kind: "log", text: `↩ you: ${[allow.length ? `allowed ${allow.join(", ")}` : "", answer].filter(Boolean).join(" — ")}`, at: Date.now() });
  patchStep(l, stepId, {
    status: "running",
    allowed: [...new Set([...(sr.allowed ?? []), ...allow])],
    questions: [],
    denials: [],
    turns: (sr.turns ?? 0) + 1,
    finishedAt: undefined,
  });
  l.run.finishedAt = undefined;
  setRunStatus(l, "running");
  void execStep(l, step, { sessionId: sr.sessionId, message }).then(() => schedule(l));
  return l.run;
}

/** Stop waiting on a blocked stage: it fails, and the stages that depend on it are skipped. */
export async function abandonStep(runId: string, stepId: string) {
  const l = await ensureLive(runId);
  const sr = l.run.stepRuns[stepId];
  if (sr?.status !== "waiting") throw new HttpError(409, "This stage is not waiting");
  patchStep(l, stepId, { status: "failed", error: "Abandoned: you chose not to answer", finishedAt: Date.now() });
  setRunStatus(l, "running");
  void schedule(l);
  return l.run;
}

export async function cancelRun(id: string) {
  const l = live.get(id) ?? (await ensureLive(id));
  if (l.run.status !== "running" && l.run.status !== "waiting") throw new HttpError(409, "Run is not active");
  for (const [stepId, sr] of Object.entries(l.run.stepRuns)) {
    if (sr.status === "pending" || sr.status === "running" || sr.status === "waiting")
      patchStep(l, stepId, { status: "cancelled", finishedAt: Date.now() });
  }
  for (const child of l.children.values()) child.kill("SIGTERM");
  finish(l, "cancelled");
}

export async function getRun(id: string): Promise<Run> {
  const l = live.get(id);
  if (l) return l.run;
  const row = db.prepare("SELECT data FROM runs WHERE id = ?").get(id) as { data: string } | undefined;
  if (!row) throw new HttpError(404, "Run not found");
  return JSON.parse(row.data) as Run;
}

export function subscribe(id: string, fn: (msg: RunMessage) => void): (() => void) | null {
  const l = live.get(id);
  if (!l) return null;
  l.listeners.add(fn);
  return () => l.listeners.delete(fn);
}

export async function listRuns(): Promise<RunSummary[]> {
  const rows = db.prepare("SELECT id, data FROM runs ORDER BY started_at DESC").all() as { id: string; data: string }[];
  // A live run's in-memory state is newer than its last save.
  return rows
    .map((r) => live.get(r.id)?.run ?? (JSON.parse(r.data) as Run))
    .map(({ stepRuns, steps, ...rest }) => ({
      ...rest,
      stepCount: steps.length,
      agentResults: steps.map((st) => ({ agent: st.agent, status: stepRuns[st.id]?.status ?? "pending" })),
      costUsd: Object.values(stepRuns).reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
    }));
}

export async function deleteRun(id: string) {
  if (live.get(id)?.run.status === "running") throw new HttpError(409, "Cancel the run before deleting it");
  live.delete(id);
  db.prepare("DELETE FROM runs WHERE id = ?").run(id);
}

/** Runs left "running" by a server that stopped mid-run can never finish; mark them failed. */
export async function recoverInterruptedRuns() {
  for (const summary of await listRuns()) {
    if (summary.status !== "running" || live.has(summary.id)) continue;
    const run = await getRun(summary.id);
    run.status = "failed";
    run.finishedAt = Date.now();
    for (const sr of Object.values(run.stepRuns)) {
      if (sr.status === "running" || sr.status === "pending") {
        sr.status = "failed";
        sr.error = "Interrupted: the server stopped during this run";
      }
    }
    saveRun(run);
  }
}
