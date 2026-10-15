import express, { type NextFunction, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Workflow } from "../shared/types.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import * as jira from "./jira.ts";
import * as lib from "./library.ts";
import * as runner from "./runner.ts";
import { getScopes, getSettings, HttpError, saveSettings } from "./store.ts";
import * as wfs from "./workflows.ts";

const PORT = Number(process.env.PORT ?? 4317);
const app = express();
app.use(express.json({ limit: "5mb" }));

type Req = Request<Record<string, string>>;

/** A Jira issue key from a request body, or undefined. */
const questKeyOf = (v: unknown) => (typeof v === "string" && /^[A-Z][A-Z0-9]+-\d+$/.test(v) ? v : undefined);
type Handler = (req: Req, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Req, res: Response, next: NextFunction) =>
  fn(req, res)
    .then((data) => {
      if (!res.headersSent) res.json(data ?? { ok: true });
    })
    .catch(next);

// ---------- settings & scopes ----------
app.get("/api/settings", h(() => getSettings()));
app.put("/api/settings", h((req) => saveSettings(req.body)));
app.get("/api/scopes", h(() => getScopes()));
app.get(
  "/api/health",
  h(async () => {
    const { claudePath } = await getSettings();
    const version = await new Promise<string | null>((resolve) =>
      execFile(claudePath, ["--version"], { timeout: 10_000 }, (err, out) => resolve(err ? null : out.trim())),
    );
    return { claudePath, version };
  }),
);

// ---------- your quests (Jira) ----------
app.get("/api/quests", h((req) => jira.questLog(req.query.refresh === "1")));
app.get("/api/quests/:key", h((req) => jira.questDetail(req.params.key.toUpperCase())));

// ---------- agents ----------
app.get("/api/agents", h(() => lib.listAgents()));
app.get("/api/agents/:scope/:file", h((req) => lib.getAgent(req.params.scope, req.params.file)));
app.put("/api/agents/:scope/:file", h((req) => lib.saveAgent(req.params.scope, req.params.file, req.body)));
app.delete("/api/agents/:scope/:file", h((req) => lib.deleteAgent(req.params.scope, req.params.file)));

// ---------- skills ----------
app.get("/api/skills", h(() => lib.listSkills()));
app.get("/api/skills/:scope/:dir", h((req) => lib.getSkill(req.params.scope, req.params.dir)));
app.get(
  "/api/skills/:scope/:dir/file",
  h(async (req) => ({ content: await lib.readSkillFile(req.params.scope, req.params.dir, String(req.query.path ?? "")) })),
);
app.put("/api/skills/:scope/:dir", h((req) => lib.saveSkill(req.params.scope, req.params.dir, req.body)));
app.delete("/api/skills/:scope/:dir", h((req) => lib.deleteSkill(req.params.scope, req.params.dir)));

// ---------- workflows ----------
app.get("/api/workflows", h(() => wfs.listWorkflows()));
app.get("/api/workflows/:id", h((req) => wfs.getWorkflow(req.params.id)));
app.put("/api/workflows/:id", h((req) => wfs.saveWorkflow(req.params.id, req.body)));
app.delete("/api/workflows/:id", h((req) => wfs.deleteWorkflow(req.params.id)));
app.post(
  "/api/workflows/:id/run",
  h(async (req) => {
    const wf = await wfs.getWorkflow(req.params.id);
    return runner.startRun({
      workflowId: wf.id,
      steps: wf.steps,
      input: String(req.body.input ?? ""),
      cwd: wf.cwd,
      permissionMode: wf.permissionMode,
      allowedTools: wf.allowedTools,
      questKey: questKeyOf(req.body.questKey),
      workflowName: req.body.questKey ? `${questKeyOf(req.body.questKey)} · ${wf.name}` : wf.name,
    });
  }),
);
app.get(
  "/api/workflows/:id/export-agent",
  h(async (req) => ({ markdown: wfs.workflowToAgentMarkdown(await wfs.getWorkflow(req.params.id)) })),
);
app.post(
  "/api/workflows/:id/install-agent",
  h(async (req) => {
    const wf: Workflow = await wfs.getWorkflow(req.params.id);
    const md = wfs.workflowToAgentMarkdown(wf);
    const scope = (await getScopes()).find((s) => s.id === req.body.scope);
    if (!scope) throw new HttpError(400, "Unknown scope");
    const { data, body } = parseFrontmatter(md);
    return lib.saveAgent(scope.id, wf.id, {
      scope: scope.id,
      file: wf.id,
      name: String(data.name),
      description: String(data.description),
      model: "inherit",
      skills: [],
      extra: {},
      body,
      path: "",
    });
  }),
);

// ---------- runs ----------
app.post(
  "/api/runs/agent",
  h(async (req) => {
    const { agent = "", prompt = "", cwd = "", model = "", permissionMode = "acceptEdits", allowedTools = "", questKey } = req.body ?? {};
    if (!String(prompt).trim()) throw new HttpError(400, "Prompt is required");
    const quest = questKeyOf(questKey);
    const who = agent ? `Agent: ${agent}` : "Claude (default)";
    return runner.startRun({
      workflowId: null,
      workflowName: quest ? `${quest} · ${agent || "Claude"}` : who,
      allowedTools: String(allowedTools),
      questKey: quest,
      steps: [{ id: "main", name: agent || "claude", agent, prompt: "{{input}}", dependsOn: [], model: model || undefined }],
      input: String(prompt),
      cwd,
      permissionMode,
    });
  }),
);
app.get("/api/runs", h(() => runner.listRuns()));
app.get("/api/runs/:id", h((req) => runner.getRun(req.params.id)));
app.post("/api/runs/:id/cancel", h(async (req) => runner.cancelRun(req.params.id)));
app.post("/api/runs/:id/steps/:step/answer", h((req) => runner.answerStep(req.params.id, req.params.step, req.body ?? {})));
app.post("/api/runs/:id/steps/:step/abandon", h((req) => runner.abandonStep(req.params.id, req.params.step)));
app.delete("/api/runs/:id", h((req) => runner.deleteRun(req.params.id)));
app.get("/api/runs/:id/stream", async (req, res, next) => {
  try {
    const run = await runner.getRun(req.params.id);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (msg: unknown) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
    send({ type: "snapshot", run });
    const unsubscribe = runner.subscribe(run.id, send);
    if (!unsubscribe) return res.end();
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
});

// ---------- static client (production) ----------
const dist = path.resolve(import.meta.dirname, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
});

await runner.recoverInterruptedRuns();
// Bound to loopback only: this server reads and writes files under ~/.claude and runs agents.
app.listen(PORT, "127.0.0.1", () => console.log(`Agent Studio API on http://127.0.0.1:${PORT}`));
