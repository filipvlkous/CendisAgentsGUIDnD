import { useEffect, useState } from "react";
import type { PermissionMode } from "../../shared/types";
import { api } from "../api";
import { go, useRoute } from "../App";
import { HeroSprite } from "../components/Sprite";
import { ErrorBox, Field, MODELS, useAsync } from "../components/ui";
import { heroForAgentName, useHeroes } from "../game/heroes";
import { sfx } from "../game/sfx";

/** Runs one agent once — the quickest way to try an agent while writing its prompt. */
export function PlaygroundPage() {
  const [, preset = ""] = useRoute();
  const { heroes } = useHeroes();
  const agents = heroes.flatMap((h) => (h.agent ? [h.agent] : []));
  const settings = useAsync(() => api.settings()).data;
  const [agent, setAgent] = useState(preset);
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<PermissionMode>("plan");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setAgent(preset), [preset]);
  useEffect(() => {
    if (settings && !cwd) setCwd(settings.projects[0] ?? "");
  }, [settings, cwd]);

  const info = agents.find((a) => a.name === agent);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await api.runAgent({ agent, prompt, cwd, model, permissionMode: mode });
      sfx("quest");
      go("runs", run.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <h1>Training Grounds</h1>
        <span className="sub">Spar with one hero: a single headless claude -p run</span>
      </div>
      <div className="panel stack">
        <div className="arena-stage">
          {(() => {
            const h = heroForAgentName(heroes, agent);
            return h ? <HeroSprite app={h.app} scale={5} walking={busy} /> : null;
          })()}
          <div className="dummy" />
        </div>
        <ErrorBox error={error} />
        <div className="grid2">
          <Field label="Hero">
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">Claude (default)</option>
              {[...new Set(agents.map((a) => a.name))].sort().map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field label="Model override">
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.filter((m) => m !== "inherit").map((m) => (
                <option key={m} value={m}>
                  {m || "(agent default)"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {info && <div className="sub">{info.description}</div>}
        <div className="grid2">
          <Field label="Working directory">
            <input className="mono" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/path/to/repo" />
          </Field>
          <Field label="Permission mode">
            <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
              <option value="plan">plan (read-only)</option>
              <option value="default">default</option>
              <option value="acceptEdits">acceptEdits</option>
              <option value="bypassPermissions">bypassPermissions</option>
            </select>
          </Field>
        </div>
        <Field label="Challenge (prompt)">
          <textarea rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ fontFamily: "inherit" }} />
        </Field>
        <div className="row">
          <button className="primary" onClick={start} disabled={busy || !prompt.trim() || !cwd.trim()}>
            Fight!
          </button>
          <span className="sub">Opens the live battle log.</span>
        </div>
      </div>
    </div>
  );
}
