import { useMemo, useState } from "react";
import type { PermissionMode, Workflow, WorkflowStep } from "../../shared/types";
import { api } from "../api";
import { go } from "../App";
import { DagView } from "../components/DagView";
import { HeroSprite } from "../components/Sprite";
import { ErrorBox, Field, fmtCost, MODELS, slugify, StatusBadge, useAsync, useScopes } from "../components/ui";
import { heroForAgentName, useHeroes, usePortraits } from "../game/heroes";
import { sfx } from "../game/sfx";

const PERMISSION_MODES: { id: PermissionMode; label: string }[] = [
  { id: "acceptEdits", label: "acceptEdits — may edit files, other tools need allow rules" },
  { id: "default", label: "default — tools that need approval are denied" },
  { id: "plan", label: "plan — read-only, no edits" },
  { id: "bypassPermissions", label: "bypassPermissions — everything allowed (trusted repos only)" },
];

const TEMPLATES: Record<string, () => Omit<Workflow, "id" | "updatedAt">> = {
  "Plan → Build → Review": () => ({
    name: "Plan, build, review",
    description: "Plans a change, implements it, then reviews and tests it in parallel.",
    cwd: "",
    permissionMode: "acceptEdits",
    steps: [
      { id: "plan", name: "Plan", agent: "", dependsOn: [], prompt: "Read the codebase and write a short, ordered implementation plan for this request. Do not edit files.\n\nRequest:\n{{input}}" },
      { id: "build", name: "Implement", agent: "", dependsOn: ["plan"], prompt: "Implement this plan. Keep changes minimal and match the surrounding code.\n\nPlan:\n{{steps.plan.output}}" },
      { id: "review", name: "Review", agent: "", dependsOn: ["build"], prompt: "Review the uncommitted changes (git diff) for bugs and risky edge cases. Do not edit files. List findings by severity.\n\nWhat was built:\n{{steps.build.output}}" },
      { id: "test", name: "Test", agent: "", dependsOn: ["build"], prompt: "Run the project's typecheck, build and tests. Report pass/fail with the relevant output. Do not edit files." },
    ],
  }),
  "Parallel research → Synthesis": () => ({
    name: "Research",
    description: "Investigates a question from three angles in parallel and merges the findings.",
    cwd: "",
    permissionMode: "plan",
    steps: [
      { id: "code", name: "Codebase", agent: "", dependsOn: [], prompt: "Answer from the codebase only, citing file:line.\n\n{{input}}" },
      { id: "history", name: "Git history", agent: "", dependsOn: [], prompt: "Answer from git log/blame: when and why did the relevant code change?\n\n{{input}}" },
      { id: "web", name: "Docs & web", agent: "", dependsOn: [], prompt: "Answer from official documentation on the web, with links.\n\n{{input}}" },
      { id: "synth", name: "Synthesis", agent: "", dependsOn: ["code", "history", "web"], prompt: "Merge these findings into one answer. Note contradictions.\n\nCodebase:\n{{steps.code.output}}\n\nHistory:\n{{steps.history.output}}\n\nDocs:\n{{steps.web.output}}" },
    ],
  }),
  Blank: () => ({
    name: "New workflow",
    description: "",
    cwd: "",
    permissionMode: "acceptEdits",
    steps: [{ id: "step1", name: "Step 1", agent: "", dependsOn: [], prompt: "{{input}}" }],
  }),
};

export function WorkflowsPage({ params }: { params: string[] }) {
  const { data: workflows, error, reload } = useAsync(() => api.workflows());
  const [id] = params;
  const selected = workflows?.find((w) => w.id === id);
  const [creating, setCreating] = useState<Workflow | null>(null);

  const startNew = async (tpl: string) => {
    const base = TEMPLATES[tpl]();
    const settings = await api.settings();
    let wid = slugify(base.name);
    while (workflows?.some((w) => w.id === wid)) wid += "-2";
    setCreating({ ...base, id: wid, cwd: settings.projects[0] ?? "", updatedAt: "" });
    go("workflows", "new");
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>War Table</h1>
        <span className="sub">Campaigns for your heroes (agent workflows). Stages run in parallel once the stages they wait for are done.</span>
        <span className="spacer" />
        <select value="" onChange={(e) => e.target.value && startNew(e.target.value)} style={{ width: "auto" }}>
          <option value="">+ Plan a campaign from…</option>
          {Object.keys(TEMPLATES).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <ErrorBox error={error} />
      <div className="split">
        <div className="list">
          {workflows?.map((w) => (
            <button key={w.id} className={`list-item ${w === selected ? "active" : ""}`} onClick={() => go("workflows", w.id)}>
              <div className="title">
                {w.name} <span className="badge">{w.steps.length} stages</span>
              </div>
              <div className="desc">{w.description || w.cwd}</div>
            </button>
          ))}
          {workflows && !workflows.length && <div className="empty">No campaigns yet. Plan one from a template.</div>}
        </div>
        <div>
          {id === "new" && creating ? (
            <WorkflowEditor key={`new-${creating.id}`} initial={creating} isNew onSaved={(w) => reload().then(() => go("workflows", w.id))} />
          ) : selected ? (
            <WorkflowEditor key={selected.id} initial={selected} onSaved={() => reload()} onDeleted={() => reload().then(() => go("workflows"))} />
          ) : (
            <div className="empty">Pick a campaign, or plan a new one.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkflowEditor({
  initial,
  isNew,
  onSaved,
  onDeleted,
}: {
  initial: Workflow;
  isNew?: boolean;
  onSaved: (w: Workflow) => void;
  onDeleted?: () => void;
}) {
  const { heroes } = useHeroes();
  const portraits = usePortraits(heroes);
  const agents = heroes.flatMap((h) => (h.agent ? [h.agent] : []));
  const runs = useAsync(() => api.runs(), [initial.id]).data?.filter((r) => r.workflowId === initial.id).slice(0, 5) ?? [];
  const scopes = useScopes();
  const [wf, setWf] = useState(initial);
  const [sel, setSel] = useState<string | null>(initial.steps[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [exported, setExported] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = isNew || JSON.stringify(wf) !== JSON.stringify(initial);
  const agentNames = useMemo(() => [...new Set(agents.map((a) => a.name))].sort(), [agents]);

  const set = (patch: Partial<Workflow>) => setWf((w) => ({ ...w, ...patch }));
  const setStep = (sid: string, patch: Partial<WorkflowStep>) =>
    setWf((w) => ({ ...w, steps: w.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }));

  const renameStep = (old: string, next: string) =>
    setWf((w) => ({
      ...w,
      steps: w.steps.map((s) => ({
        ...s,
        id: s.id === old ? next : s.id,
        dependsOn: s.dependsOn.map((d) => (d === old ? next : d)),
        prompt: s.prompt.replaceAll(`{{steps.${old}.output}}`, `{{steps.${next}.output}}`),
      })),
    }));

  const addStep = () => {
    let n = wf.steps.length + 1;
    while (wf.steps.some((s) => s.id === `step${n}`)) n++;
    const last = wf.steps[wf.steps.length - 1];
    const step: WorkflowStep = {
      id: `step${n}`,
      name: `Step ${n}`,
      agent: "",
      dependsOn: last ? [last.id] : [],
      prompt: last ? `{{steps.${last.id}.output}}` : "{{input}}",
    };
    set({ steps: [...wf.steps, step] });
    setSel(step.id);
  };
  const removeStep = (sid: string) =>
    set({ steps: wf.steps.filter((s) => s.id !== sid).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== sid) })) });
  const move = (sid: string, dir: -1 | 1) => {
    const i = wf.steps.findIndex((s) => s.id === sid);
    const j = i + dir;
    if (j < 0 || j >= wf.steps.length) return;
    const steps = [...wf.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    set({ steps });
  };

  const save = async () => {
    setError(null);
    try {
      const out = await api.saveWorkflow(wf);
      setWf(out);
      onSaved(out);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const run = async () => {
    if (dirty && !(await save())) return;
    try {
      const r = await api.runWorkflow(wf.id, input);
      sfx("quest");
      go("runs", r.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    await api.deleteWorkflow(wf.id);
    onDeleted?.();
  };
  const install = async (scope: string) => {
    try {
      const a = await api.installAgent(wf.id, scope);
      setNotice(`Installed as agent "${a.name}" at ${a.path}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unknownAgents = wf.steps.filter((s) => s.agent && !agentNames.includes(s.agent));

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>{wf.name || "Untitled"}</h2>
          <span className="sub mono">{wf.id}</span>
          <span style={{ flex: 1 }} />
          {!isNew && (
            <>
              <button className="danger" onClick={remove}>
                Delete
              </button>
              <button onClick={async () => setExported(exported ? null : (await api.exportAgent(wf.id)).markdown)}>
                {exported ? "Hide guild-leader export" : "Export as guild leader"}
              </button>
            </>
          )}
          <button className="primary" onClick={save} disabled={!dirty}>
            Save
          </button>
        </div>
        <ErrorBox error={error} />
        {notice && <div className="badge ok" style={{ padding: "6px 10px" }}>{notice}</div>}
        <div className="grid2">
          <Field label="Name">
            <input value={wf.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          {isNew ? (
            <Field label="Id">
              <input value={wf.id} onChange={(e) => set({ id: slugify(e.target.value) })} />
            </Field>
          ) : (
            <div />
          )}
        </div>
        <Field label="Description">
          <input value={wf.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid2">
          <Field label="Working directory" hint="The repo the agents work in; project agents and skills from it are available">
            <input className="mono" value={wf.cwd} onChange={(e) => set({ cwd: e.target.value })} placeholder="/path/to/repo" />
          </Field>
          <Field label="Permission mode">
            <select value={wf.permissionMode} onChange={(e) => set({ permissionMode: e.target.value as PermissionMode })}>
              {PERMISSION_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Allowed tools"
          hint="Permission rules the heroes may use without asking (headless runs can't answer prompts). Comma-separated, e.g. Bash(curl:*), Bash(jq:*), Read"
        >
          <input className="mono" value={wf.allowedTools ?? ""} onChange={(e) => set({ allowedTools: e.target.value })} placeholder="(none)" />
        </Field>
        {wf.permissionMode === "bypassPermissions" && (
          <div className="warn-box">Agents will run every tool without asking, including shell commands. Use only in a repo you trust and can reset.</div>
        )}
        {unknownAgents.length > 0 && (
          <div className="warn-box">
            Unknown agents: {unknownAgents.map((s) => `${s.agent} (step ${s.id})`).join(", ")}. They may exist only in the working directory's .claude/agents.
          </div>
        )}
        {exported && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <span className="sub">A guild-leader agent that runs this quest by summoning the heroes as subagents inside a normal Claude Code session.</span>
              <span style={{ flex: 1 }} />
              {scopes.map((s) => (
                <button key={s.id} className="small" onClick={() => install(s.id)}>
                  Install to {s.label}
                </button>
              ))}
            </div>
            <pre className="output">{exported}</pre>
          </div>
        )}
      </div>

      <DagView steps={wf.steps} selected={sel} onSelect={setSel} portraits={portraits} />

      <div className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>Stages</h2>
          <span className="sub">
            Variables: <code>{"{{input}}"}</code>, <code>{"{{steps.<id>.output}}"}</code>
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={addStep}>+ Add stage</button>
        </div>
        {wf.steps.map((s, i) => (
          <div key={i} className={`step-card stack ${sel === s.id ? "selected" : ""}`} onFocus={() => setSel(s.id)} onClick={() => setSel(s.id)}>
            <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
              {(() => {
                const h = heroForAgentName(heroes, s.agent);
                return h ? <HeroSprite app={h.app} scale={2} /> : null;
              })()}
            <div className="grid4" style={{ flex: 1 }}>
              <Field label="Id">
                <input className="mono" value={s.id} onChange={(e) => renameStep(s.id, e.target.value.replace(/[^\w-]/g, ""))} />
              </Field>
              <Field label="Name">
                <input value={s.name} onChange={(e) => setStep(s.id, { name: e.target.value })} />
              </Field>
              <Field label="Hero">
                <select
                  value={s.agent}
                  onChange={(e) => {
                    sfx("select");
                    setStep(s.id, { agent: e.target.value });
                  }}
                >
                  <option value="">Claude (default)</option>
                  {[...new Set([...agentNames, s.agent].filter(Boolean))].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Model override">
                <select value={s.model ?? ""} onChange={(e) => setStep(s.id, { model: e.target.value || undefined })}>
                  {MODELS.filter((m) => m !== "inherit").map((m) => (
                    <option key={m} value={m}>
                      {m || "(agent default)"}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="sub">Waits for:</span>
              {wf.steps.filter((o) => o.id !== s.id).map((o) => (
                <span
                  key={o.id}
                  className={`chip ${s.dependsOn.includes(o.id) ? "on" : ""}`}
                  onClick={() =>
                    setStep(s.id, { dependsOn: s.dependsOn.includes(o.id) ? s.dependsOn.filter((d) => d !== o.id) : [...s.dependsOn, o.id] })
                  }
                >
                  {o.id}
                </span>
              ))}
              {wf.steps.length === 1 && <span className="sub">—</span>}
            </div>
            <textarea rows={5} value={s.prompt} onChange={(e) => setStep(s.id, { prompt: e.target.value })} />
            <div className="row" style={{ gap: 6 }}>
              <span className="sub">Insert:</span>
              {["{{input}}", ...s.dependsOn.map((d) => `{{steps.${d}.output}}`)].map((v) => (
                <span key={v} className="chip mono" onClick={() => setStep(s.id, { prompt: `${s.prompt}${s.prompt.endsWith("\n") || !s.prompt ? "" : "\n"}${v}` })}>
                  {v}
                </span>
              ))}
              <span style={{ flex: 1 }} />
              <button className="small ghost" onClick={() => move(s.id, -1)} disabled={i === 0}>
                ↑
              </button>
              <button className="small ghost" onClick={() => move(s.id, 1)} disabled={i === wf.steps.length - 1}>
                ↓
              </button>
              <button className="small danger" onClick={() => removeStep(s.id)} disabled={wf.steps.length === 1}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Embark</h2>
        <Field label="Quest briefing" hint={<>Every stage receives it as <code>{"{{input}}"}</code></>}>
          <textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)} style={{ fontFamily: "inherit" }} />
        </Field>
        <div className="row">
          <button className="primary" onClick={run} disabled={!wf.cwd.trim()}>
            {dirty ? "Save & embark!" : "Embark!"}
          </button>
          {!wf.cwd.trim() && <span className="sub">Set a working directory first</span>}
        </div>
        {runs.length > 0 && (
          <table>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="click" onClick={() => go("runs", r.id)}>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="sub">{r.input.slice(0, 80)}</td>
                  <td>{fmtCost(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
