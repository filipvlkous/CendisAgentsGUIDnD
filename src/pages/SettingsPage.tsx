import { useEffect, useState } from "react";
import type { Settings } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, Field, useAsync } from "../components/ui";

export function SettingsPage() {
  const { data, reload } = useAsync(() => api.settings());
  const health = useAsync(() => api.health(), [data]);
  const [s, setS] = useState<Settings | null>(null);
  const [newProject, setNewProject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  if (!s) return <div className="page sub">Loading…</div>;

  const save = async (next: Settings) => {
    setError(null);
    try {
      setS(await api.saveSettings(next));
      setSaved(true);
      void reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <h1>Guild Settings</h1>
      </div>
      <div className="stack">
        <ErrorBox error={error} />
        <div className="panel stack">
          <h2>Claude CLI</h2>
          <Field
            label="Path to the claude executable"
            hint={
              health.data?.version ? (
                <span style={{ color: "var(--ok)" }}>Found: {health.data.version}</span>
              ) : (
                <span style={{ color: "var(--err)" }}>Not found. Try the full path, e.g. ~/.local/bin/claude (run `which claude`).</span>
              )
            }
          >
            <input className="mono" value={s.claudePath} onChange={(e) => setS({ ...s, claudePath: e.target.value })} />
          </Field>
          <div>
            <button className="primary" onClick={() => save(s)}>
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        <div className="panel stack">
          <h2>Quest giver (Jira)</h2>
          <Field
            label="Jira credentials file"
            hint="A .loc.env with JIRA_DOMAIN, JIRA_EMAIL and JIRA_API_TOKEN. Only the local server reads it; the token never reaches the browser."
          >
            <input
              className="mono"
              value={s.jiraEnvFile}
              onChange={(e) => setS({ ...s, jiraEnvFile: e.target.value })}
              placeholder="~/code/my-repo/.loc.env"
            />
          </Field>
          <div>
            <button className="primary" onClick={() => save(s)}>
              Save
            </button>
          </div>
        </div>

        <div className="panel stack">
          <h2>Realms (projects)</h2>
          <div className="sub">
            Each project adds its <code>.claude/agents</code> and <code>.claude/skills</code> as a scope, and the first project
            is the default working directory for new workflows. Your user scope <code>~/.claude</code> is always included.
          </div>
          {s.projects.map((p) => (
            <div key={p} className="row">
              <code style={{ flex: 1 }}>{p}</code>
              <button className="small danger" onClick={() => save({ ...s, projects: s.projects.filter((x) => x !== p) })}>
                Remove
              </button>
            </div>
          ))}
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input className="mono" placeholder="/Users/you/code/my-repo" value={newProject} onChange={(e) => setNewProject(e.target.value)} />
            <button
              disabled={!newProject.trim()}
              onClick={() => {
                void save({ ...s, projects: [...s.projects, newProject.trim()] });
                setNewProject("");
              }}
            >
              Add project
            </button>
          </div>
        </div>

        <div className="panel stack">
          <h2>Safety</h2>
          <div className="sub">
            The server listens on 127.0.0.1 only. Every agent or skill you overwrite or delete is first copied to{" "}
            <code>data/backups</code>. Workflow runs use the permission mode set on the workflow; prefer <code>plan</code> or{" "}
            <code>acceptEdits</code> and add allow rules in the project's <code>.claude/settings.json</code> for the shell
            commands your agents need.
          </div>
        </div>
      </div>
    </div>
  );
}
