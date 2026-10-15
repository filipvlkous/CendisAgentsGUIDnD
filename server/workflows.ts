import type { Workflow, WorkflowStep } from "../shared/types.ts";
import { db } from "./db.ts";
import { assertSafeId, HttpError } from "./store.ts";

export async function listWorkflows(): Promise<Workflow[]> {
  const rows = db.prepare("SELECT data FROM workflows ORDER BY updated_at DESC").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Workflow);
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const row = db.prepare("SELECT data FROM workflows WHERE id = ?").get(assertSafeId(id)) as { data: string } | undefined;
  if (!row) throw new HttpError(404, `Workflow "${id}" not found`);
  return JSON.parse(row.data) as Workflow;
}

export async function saveWorkflow(id: string, wf: Workflow): Promise<Workflow> {
  assertSafeId(id);
  validateSteps(wf.steps);
  const saved: Workflow = { ...wf, id, updatedAt: new Date().toISOString() };
  db.prepare(
    `INSERT INTO workflows (id, updated_at, data) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`,
  ).run(id, saved.updatedAt, JSON.stringify(saved));
  return saved;
}

export async function deleteWorkflow(id: string) {
  db.prepare("DELETE FROM workflows WHERE id = ?").run(assertSafeId(id));
}

/** Rejects duplicate ids, unknown dependencies and cycles. */
export function validateSteps(steps: WorkflowStep[]) {
  if (!steps.length) throw new HttpError(400, "A workflow needs at least one step");
  const ids = new Set<string>();
  for (const s of steps) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(s.id)) throw new HttpError(400, `Invalid step id "${s.id}"`);
    if (ids.has(s.id)) throw new HttpError(400, `Duplicate step id "${s.id}"`);
    ids.add(s.id);
  }
  for (const s of steps) {
    for (const d of s.dependsOn) {
      if (!ids.has(d)) throw new HttpError(400, `Step "${s.id}" depends on unknown step "${d}"`);
    }
  }
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, trail: string[]) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new HttpError(400, `Cycle: ${[...trail, id].join(" → ")}`);
    state.set(id, "visiting");
    for (const d of byId.get(id)!.dependsOn) visit(d, [...trail, id]);
    state.set(id, "done");
  };
  steps.forEach((s) => visit(s.id, []));
}

/**
 * Renders a workflow as a Claude Code orchestrator agent: one agent that calls the
 * step agents as subagents in dependency order, so the pipeline also runs inside
 * an interactive session.
 */
export function workflowToAgentMarkdown(wf: Workflow): string {
  const order = topoOrder(wf.steps);
  const lines = order.map((s, i) => {
    const deps = s.dependsOn.length ? ` Wait for: ${s.dependsOn.map((d) => `\`${d}\``).join(", ")}.` : "";
    const who = s.agent ? `the \`${s.agent}\` subagent` : "a general-purpose subagent";
    const prompt = s.prompt
      .replace(/\{\{\s*input\s*\}\}/g, "<the user's request>")
      .replace(/\{\{\s*steps\.([\w-]+)\.output\s*\}\}/g, "<result of step `$1`>");
    return `${i + 1}. **${s.name || s.id}** (\`${s.id}\`) — call ${who}.${deps}\n   Prompt:\n\n${indent(prompt, 6)}\n`;
  });
  const agents = [...new Set(wf.steps.map((s) => s.agent).filter(Boolean))];
  const fm = [
    "---",
    `name: ${wf.id}`,
    `description: ${JSON.stringify(wf.description || `Runs the ${wf.name} workflow`)}`,
    "model: inherit",
    "---",
  ].join("\n");
  return `${fm}

You orchestrate the **${wf.name}** workflow. ${wf.description}

Run the steps below with the Agent tool. Steps whose dependencies are met may run
in parallel. Pass each step the outputs it references. If a step fails, stop and
report which step failed and why — do not run the steps that depend on it.

Agents used: ${agents.map((a) => `\`${a}\``).join(", ") || "general-purpose only"}.

## Steps

${lines.join("\n")}
## Result

When all steps are done, reply with a short summary of each step's result and the
final step's output in full.
`;
}

function indent(text: string, n: number) {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((l) => (l ? pad + l : l))
    .join("\n");
}

export function topoOrder(steps: WorkflowStep[]): WorkflowStep[] {
  const done = new Set<string>();
  const out: WorkflowStep[] = [];
  while (out.length < steps.length) {
    const ready = steps.filter((s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d)));
    if (!ready.length) break;
    ready.forEach((s) => {
      done.add(s.id);
      out.push(s);
    });
  }
  return out;
}
