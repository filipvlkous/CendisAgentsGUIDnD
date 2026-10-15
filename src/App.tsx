import { useEffect, useState } from "react";
import { api } from "./api";
import { AgentsPage } from "./pages/AgentsPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { QuestLogPage } from "./pages/QuestLogPage";
import { RunsPage } from "./pages/RunsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { TownPage } from "./pages/TownPage";
import { isMuted, setMuted, sfx } from "./game/sfx";
import { WorkflowsPage } from "./pages/WorkflowsPage";

/** Hash routes: #/<section>/<rest...> */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function go(...parts: string[]) {
  window.location.hash = "/" + parts.map(encodeURIComponent).join("/");
}

const NAV = [
  ["town", "🏰", "Town"],
  ["quests", "❗", "Quest Log"],
  ["agents", "🛡", "Hero Hall"],
  ["skills", "📜", "Skill Shrine"],
  ["workflows", "⛺", "War Table"],
  ["playground", "🎯", "Training"],
  ["runs", "📖", "Chronicle"],
  ["settings", "⚙", "Settings"],
] as const;

export function App() {
  const [section = "town", ...rest] = useRoute();
  const [version, setVersion] = useState<string | null | undefined>();
  const [muted, setMutedState] = useState(isMuted());
  useEffect(() => {
    api.health().then((h) => setVersion(h.version), () => setVersion(null));
  }, [section]);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="dot" /> Agent Guild
        </div>
        {NAV.map(([id, icon, label]) => (
          <a key={id} href={`#/${id}`} className={`nav-item ${section === id ? "active" : ""}`} onClick={() => sfx("click")}>
            <span className="nav-icon">{icon}</span>
            {label}
          </a>
        ))}
        <div className="foot">
          <button
            className="small ghost"
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
              if (muted) sfx("select");
            }}
          >
            {muted ? "🔇 Sound off" : "🔊 Sound on"}
          </button>
          <br />
          {version === undefined ? "…" : version ? `claude ${version.split(" ")[0]}` : <span style={{ color: "var(--err)" }}>claude CLI not found</span>}
        </div>
      </nav>
      <main className="main">
        {section === "town" && <TownPage />}
        {section === "quests" && <QuestLogPage params={rest} />}
        {section === "agents" && <AgentsPage params={rest} />}
        {section === "skills" && <SkillsPage params={rest} />}
        {section === "workflows" && <WorkflowsPage params={rest} />}
        {section === "playground" && <PlaygroundPage />}
        {section === "runs" && <RunsPage params={rest} />}
        {section === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
