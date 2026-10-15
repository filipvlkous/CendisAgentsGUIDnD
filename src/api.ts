import type {
  AgentDoc,
  PermissionMode,
  QuestDetail,
  QuestLog,
  Run,
  RunSummary,
  Scope,
  Settings,
  SkillDoc,
  Workflow,
} from "../shared/types";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (s: Settings) => req<Settings>("PUT", "/api/settings", s),
  health: () => req<{ claudePath: string; version: string | null }>("GET", "/api/health"),
  scopes: () => req<Scope[]>("GET", "/api/scopes"),

  quests: (refresh = false) => req<QuestLog>("GET", `/api/quests${refresh ? "?refresh=1" : ""}`),
  quest: (key: string) => req<QuestDetail>("GET", `/api/quests/${enc(key)}`),

  agents: () => req<AgentDoc[]>("GET", "/api/agents"),
  saveAgent: (a: AgentDoc) => req<AgentDoc>("PUT", `/api/agents/${enc(a.scope)}/${enc(a.file)}`, a),
  deleteAgent: (scope: string, file: string) => req("DELETE", `/api/agents/${enc(scope)}/${enc(file)}`),

  skills: () => req<SkillDoc[]>("GET", "/api/skills"),
  saveSkill: (s: SkillDoc) => req<SkillDoc>("PUT", `/api/skills/${enc(s.scope)}/${enc(s.dir)}`, s),
  deleteSkill: (scope: string, dir: string) => req("DELETE", `/api/skills/${enc(scope)}/${enc(dir)}`),
  skillFile: (scope: string, dir: string, path: string) =>
    req<{ content: string }>("GET", `/api/skills/${enc(scope)}/${enc(dir)}/file?path=${enc(path)}`),

  workflows: () => req<Workflow[]>("GET", "/api/workflows"),
  saveWorkflow: (w: Workflow) => req<Workflow>("PUT", `/api/workflows/${enc(w.id)}`, w),
  deleteWorkflow: (id: string) => req("DELETE", `/api/workflows/${enc(id)}`),
  runWorkflow: (id: string, input: string, questKey?: string) => req<Run>("POST", `/api/workflows/${enc(id)}/run`, { input, questKey }),
  exportAgent: (id: string) => req<{ markdown: string }>("GET", `/api/workflows/${enc(id)}/export-agent`),
  installAgent: (id: string, scope: string) => req<AgentDoc>("POST", `/api/workflows/${enc(id)}/install-agent`, { scope }),

  runAgent: (body: {
    agent: string;
    prompt: string;
    cwd: string;
    model: string;
    permissionMode: PermissionMode;
    allowedTools?: string;
    questKey?: string;
  }) =>
    req<Run>("POST", "/api/runs/agent", body),
  runs: () => req<RunSummary[]>("GET", "/api/runs"),
  run: (id: string) => req<Run>("GET", `/api/runs/${enc(id)}`),
  cancelRun: (id: string) => req("POST", `/api/runs/${enc(id)}/cancel`),
  answerStep: (id: string, step: string, body: { answer: string; allow: string[] }) =>
    req<Run>("POST", `/api/runs/${enc(id)}/steps/${enc(step)}/answer`, body),
  abandonStep: (id: string, step: string) => req<Run>("POST", `/api/runs/${enc(id)}/steps/${enc(step)}/abandon`),
  deleteRun: (id: string) => req("DELETE", `/api/runs/${enc(id)}`),
};
