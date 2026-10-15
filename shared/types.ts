// Types shared by the server and the web client.

export interface Scope {
  id: string; // "user" or "p<index>"
  label: string;
  dir: string; // the .claude directory this scope reads and writes
}

export interface AgentDoc {
  scope: string;
  file: string; // file name without .md — the id within its scope
  name: string;
  description: string;
  model?: string;
  effort?: string;
  color?: string;
  tools?: string; // comma-separated, as Claude Code writes it
  skills: string[]; // skills preloaded into the subagent (frontmatter `skills`) — the hero's equipment
  extra: Record<string, unknown>; // unknown frontmatter keys, preserved on save
  body: string; // the system prompt
  path: string;
}

export interface SkillDoc {
  scope: string;
  dir: string; // directory name — the id within its scope
  name: string;
  description: string;
  extra: Record<string, unknown>;
  body: string;
  files: string[]; // other files in the skill directory, relative paths
  path: string;
}

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface WorkflowStep {
  id: string; // referenced as {{steps.<id>.output}}
  name: string;
  agent: string; // agent name, or "" for the default Claude Code agent
  prompt: string;
  dependsOn: string[];
  model?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  cwd: string; // working directory the agents run in
  permissionMode: PermissionMode;
  /** Permission rules every stage may use without asking, e.g. "Bash(curl:*), Read". Headless runs can't answer prompts. */
  allowedTools?: string;
  steps: WorkflowStep[];
  updatedAt: string;
}

/** "waiting": the hero is blocked and asked you something; answer it to resume the same session. */
export type StepStatus = "pending" | "running" | "waiting" | "done" | "failed" | "skipped" | "cancelled";
export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled";

/** A tool call Claude Code refused, with the allow rule that would let it through. */
export interface Denial {
  tool: string;
  input: string;
  rule: string;
}

export type StepEvent =
  | { kind: "text"; text: string; at: number }
  | { kind: "tool"; name: string; input: string; at: number }
  | { kind: "tool_result"; text: string; isError: boolean; at: number }
  | { kind: "log"; text: string; at: number };

export interface StepRun {
  status: StepStatus;
  prompt?: string;
  output?: string;
  error?: string;
  events: StepEvent[];
  costUsd?: number;
  sessionId?: string;
  startedAt?: number;
  finishedAt?: number;
  questions?: string[]; // QUESTION: lines from the hero's last reply
  denials?: Denial[]; // tools refused during the last turn
  allowed?: string[]; // extra allow rules you granted this stage when answering
  turns?: number; // how many times you answered and it resumed
}

export interface Run {
  id: string;
  workflowId: string | null; // null for a one-off agent run
  workflowName: string;
  input: string;
  cwd: string;
  status: RunStatus;
  steps: WorkflowStep[];
  stepRuns: Record<string, StepRun>;
  startedAt: number;
  finishedAt?: number;
  questKey?: string; // the Jira quest (issue key) this run was started for, from the Quest Log
  permissionMode?: PermissionMode; // kept so a waiting run can resume after a server restart
  allowedTools?: string[];
}

export type RunSummary = Omit<Run, "stepRuns" | "steps"> & {
  costUsd: number;
  stepCount: number;
  /** One entry per step: which agent ("" = default Claude) and how it ended. Drives hero XP. */
  agentResults: { agent: string; status: StepStatus }[];
};

/** Messages sent over a run's event stream. */
export type RunMessage =
  | { type: "snapshot"; run: Run }
  | { type: "step"; stepId: string; patch: Partial<StepRun> }
  | { type: "event"; stepId: string; event: StepEvent }
  | { type: "status"; status: RunStatus; finishedAt?: number };

export interface Settings {
  claudePath: string;
  projects: string[]; // project roots; each contributes <root>/.claude
  jiraEnvFile: string; // a .loc.env with JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN — read by the server only
}

// ---------- your own quests: Jira issues assigned to you ----------

export interface JiraQuest {
  key: string;
  url: string;
  summary: string;
  status: string;
  category: "new" | "indeterminate" | "done" | string;
  type: string;
  priority: string;
  difficulty: number; // 1–5 from the priority
  project: string;
  parent?: { key: string; summary: string };
  updated: string;
  due?: string;
}

export interface QuestLog {
  player: { name: string; avatar?: string };
  quests: JiraQuest[];
  completed: number | null; // resolved issues assigned to you, for the player level
  fetchedAt: number;
}

export interface QuestDetail extends JiraQuest {
  reporter: string;
  description: string; // ADF flattened to text, images as [[image: name]]
  comments: { author: string; created: string; edited: boolean; text: string }[];
  links: string[];
  images: string[];
}
