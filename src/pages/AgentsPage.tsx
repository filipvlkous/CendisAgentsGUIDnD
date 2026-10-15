import { useEffect, useMemo, useState } from "react";
import type { AgentDoc, SkillDoc } from "../../shared/types";
import { api } from "../api";
import { go } from "../App";
import { HeroSprite, SkillIcon } from "../components/Sprite";
import { ErrorBox, Field, ScopeBadge, slugify, useAsync, useScopes } from "../components/ui";
import { useHeroes } from "../game/heroes";
import { emptyStats, type HeroStats } from "../game/progress";
import { sfx } from "../game/sfx";
import { appearanceFor, CLASS_INFO, classFor, GEAR_SLOTS, onDemandSkills, OUTFIT, WEAPON_INFO } from "../game/sprite";

const COMMON_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch", "Skill", "Agent", "NotebookEdit", "TodoWrite"];

const CLASSES = [
  { model: "", label: "Adventurer (unset)" },
  { model: "inherit", label: "Adventurer (inherit)" },
  { model: "opus", label: "Wizard (opus)" },
  { model: "fable", label: "Wizard (fable)" },
  { model: "sonnet", label: "Knight (sonnet)" },
  { model: "haiku", label: "Rogue (haiku)" },
];

const blank = (): AgentDoc => ({
  scope: "user",
  file: "",
  name: "",
  description: "",
  model: "sonnet",
  tools: "Read, Grep, Glob",
  skills: [],
  extra: {},
  body: "You are a specialist agent. Describe the job, the inputs you receive from the parent agent, what you may and may not do, and the exact shape of the result you return.\n",
  path: "",
});

export function AgentsPage({ params }: { params: string[] }) {
  const { heroes, error, reload } = useHeroes();
  const skills = useAsync(() => api.skills()).data ?? [];
  const scopes = useScopes();
  const [filter, setFilter] = useState("");
  const [scope, file] = params;
  const isNew = scope === "new";
  const agentHeroes = heroes.filter((h) => h.agent);
  const selected = agentHeroes.find((h) => h.agent!.scope === scope && h.agent!.file === file);

  const dupes = useMemo(() => {
    const count = new Map<string, number>();
    agentHeroes.forEach((h) => count.set(h.name, (count.get(h.name) ?? 0) + 1));
    return new Set([...count].filter(([, n]) => n > 1).map(([n]) => n));
  }, [agentHeroes]);

  const shown = agentHeroes.filter((h) => `${h.name} ${h.agent!.description}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Hero Hall</h1>
        <span className="sub">Your agents. Model → class · tools → weapon · skills → gear</span>
        <span className="spacer" />
        <button
          className="primary"
          onClick={() => {
            sfx("select");
            go("agents", "new");
          }}
        >
          + Recruit hero
        </button>
      </div>
      <ErrorBox error={error} />
      <div className="split">
        <div className="list">
          <input placeholder="Search heroes…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {shown.map((h) => (
            <button
              key={h.key}
              className={`list-item hero-item ${h === selected ? "active" : ""}`}
              onClick={() => {
                sfx("click");
                go("agents", h.agent!.scope, h.agent!.file);
              }}
            >
              <HeroSprite app={h.app} scale={2} />
              <div style={{ minWidth: 0 }}>
                <div className="title">
                  {h.name}
                  <span className="lv">Lv{h.stats.level}</span>
                  <ScopeBadge scope={h.agent!.scope} scopes={scopes} />
                  {dupes.has(h.name) && <span className="badge warn">duplicate</span>}
                </div>
                <div className="desc">
                  {CLASS_INFO[h.app.cls].label} · {h.app.gear.filter((g) => !g.ghost).length} equipped
                  {h.app.gear.some((g) => g.ghost) ? ` · ${h.app.gear.filter((g) => g.ghost).length} on demand` : ""} · {h.agent!.description}
                </div>
              </div>
            </button>
          ))}
          {!shown.length && <div className="empty">No heroes yet</div>}
        </div>
        <div>
          {isNew ? (
            <CharacterSheet key="new" initial={blank()} isNew skills={skills} onSaved={(a) => reload().then(() => go("agents", a.scope, a.file))} />
          ) : selected ? (
            <CharacterSheet
              key={selected.key}
              initial={selected.agent!}
              stats={selected.stats}
              skills={skills}
              duplicate={dupes.has(selected.name) ? agentHeroes.filter((h) => h.name === selected.name && h !== selected).map((h) => h.agent!) : []}
              onSaved={() => reload()}
              onDeleted={() => reload().then(() => go("agents"))}
            />
          ) : (
            <div className="empty">Pick a hero from the roster, or recruit a new one.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CharacterSheet({
  initial,
  isNew,
  stats = emptyStats(),
  skills,
  duplicate = [],
  onSaved,
  onDeleted,
}: {
  initial: AgentDoc;
  isNew?: boolean;
  stats?: HeroStats;
  skills: SkillDoc[];
  duplicate?: AgentDoc[];
  onSaved: (a: AgentDoc) => void;
  onDeleted?: () => void;
}) {
  const scopes = useScopes();
  const [doc, setDoc] = useState(initial);
  const [fileTouched, setFileTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(doc) !== JSON.stringify(initial);
  const set = (patch: Partial<AgentDoc>) => {
    setDoc((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const skillNames = [...new Set(skills.map((s) => s.name))].sort();
  // on demand = named in the orders and reachable through the Skill tool; drawn as ghost gear
  const onDemand = onDemandSkills(doc, skillNames);
  const app = appearanceFor({ ...doc, onDemand });

  useEffect(() => {
    if (isNew && !fileTouched) setDoc((d) => ({ ...d, file: slugify(d.name) }));
  }, [doc.name, isNew, fileTouched]);

  const tools = (doc.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const toggleTool = (t: string) => {
    sfx("click");
    set({ tools: (tools.includes(t) ? tools.filter((x) => x !== t) : [...tools, t]).join(", ") });
  };
  const toggleSkill = (name: string) => {
    const on = doc.skills.includes(name);
    sfx(on ? "unequip" : "equip");
    set({ skills: on ? doc.skills.filter((s) => s !== name) : [...doc.skills, name] });
  };
  // named in the orders, but the hero has a tools list without Skill, so it cannot load it
  const unreachable = onDemandSkills({ ...doc, tools: "" }, skillNames).filter((n) => !onDemand.includes(n));
  const unknownEquipped = doc.skills.filter((s) => !skillNames.includes(s));

  const save = async () => {
    setError(null);
    try {
      const out = await api.saveAgent(doc);
      setDoc(out);
      setSaved(true);
      sfx("save");
      onSaved(out);
    } catch (e) {
      setError((e as Error).message);
      sfx("fail");
    }
  };
  const remove = async () => {
    if (!confirm(`Dismiss hero "${doc.name}"? The agent file is deleted (a backup is kept in data/backups).`)) return;
    await api.deleteAgent(doc.scope, doc.file).catch((e: Error) => setError(e.message));
    onDeleted?.();
  };

  const pct = Math.round(((stats.xp - stats.floor) / Math.max(1, stats.next - stats.floor)) * 100);
  const words = doc.body.split(/\s+/).filter(Boolean).length;
  const statRows: [string, number, string][] = [
    ["POW", Math.min(10, tools.length || 10), tools.length ? `${tools.length} tools` : "every tool"],
    ["INT", Math.min(10, Math.ceil(words / 120)), `${words} words of orders`],
    ["MAG", Math.min(10, doc.skills.length * 2), `${doc.skills.length} skills`],
    ["FOC", { low: 2, medium: 4, high: 6, xhigh: 8, max: 10 }[doc.effort ?? ""] ?? 5, doc.effort ?? "default effort"],
  ];

  return (
    <div className="stack">
      <div className="panel sheet">
        <div className="sheet-portrait">
          <div className="portrait big">
            <HeroSprite app={app} scale={6} />
          </div>
          <div className="stack" style={{ gap: 6, width: "100%" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>Lv {stats.level}</b>
              <span className="sub">{stats.xp} XP</span>
            </div>
            <div className="xpbar">
              <div style={{ width: `${pct}%` }} />
            </div>
            {statRows.map(([k, v, hint]) => (
              <div key={k} className="statrow" title={hint}>
                <span>{k}</span>
                <div className="pips">
                  {Array.from({ length: 10 }, (_, i) => (
                    <i key={i} className={i < v ? "on" : ""} />
                  ))}
                </div>
              </div>
            ))}
            <div className="sub">
              {stats.questsWon} quests won · {stats.questsLost} lost
            </div>
          </div>
        </div>

        <div className="stack" style={{ flex: 1, minWidth: 0 }}>
          <div className="row">
            <h2 style={{ margin: 0 }}>{isNew ? "New recruit" : doc.name || "Unnamed"}</h2>
            <span className="badge">{CLASS_INFO[app.cls].label}</span>
            <span style={{ flex: 1 }} />
            {!isNew && (
              <button onClick={() => go("playground", doc.name)} title="Spar with this hero in the training grounds">
                Train
              </button>
            )}
            {!isNew && (
              <button className="danger" onClick={remove}>
                Dismiss
              </button>
            )}
            <button className="primary" onClick={save} disabled={!dirty && !isNew}>
              {saved && !dirty ? "Saved!" : "Save hero"}
            </button>
          </div>
          {!isNew && <span className="sub mono">{initial.path}</span>}
          {duplicate.length > 0 && (
            <div className="warn-box">
              Another hero also answers to <b>{doc.name}</b> ({duplicate.map((d) => d.path).join(", ")}). Claude Code keys agents by
              name, so only one of them can be summoned. Rename one.
            </div>
          )}
          <ErrorBox error={error} />
          <div className="grid2">
            <Field label="Name" hint="What summoners call (subagent_type)">
              <input value={doc.name} onChange={(e) => set({ name: e.target.value })} placeholder="code-reviewer" />
            </Field>
            {isNew ? (
              <div className="grid2">
                <Field label="Home">
                  <select value={doc.scope} onChange={(e) => set({ scope: e.target.value })}>
                    {scopes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="File">
                  <input
                    value={doc.file}
                    onChange={(e) => {
                      setFileTouched(true);
                      set({ file: e.target.value });
                    }}
                  />
                </Field>
              </div>
            ) : (
              <Field label="Class (model)" hint={CLASS_INFO[classFor(doc.model)].blurb}>
                <ClassSelect value={doc.model} onChange={(model) => set({ model })} />
              </Field>
            )}
          </div>
          {isNew && (
            <Field label="Class (model)" hint={CLASS_INFO[classFor(doc.model)].blurb}>
              <ClassSelect value={doc.model} onChange={(model) => set({ model })} />
            </Field>
          )}
          <div className="grid2">
            <Field label="Banner color">
              <div className="swatches">
                {Object.entries(OUTFIT).map(([name, hex]) => (
                  <button
                    key={name}
                    className={`swatch-btn ${doc.color === name ? "on" : ""}`}
                    style={{ background: hex }}
                    title={name}
                    onClick={(e) => {
                      e.preventDefault();
                      sfx("click");
                      set({ color: doc.color === name ? undefined : name });
                    }}
                  />
                ))}
              </div>
            </Field>
            <Field label="Focus (effort)">
              <select value={doc.effort ?? ""} onChange={(e) => set({ effort: e.target.value || undefined })}>
                {["", "low", "medium", "high", "xhigh", "max"].map((m) => (
                  <option key={m} value={m}>
                    {m || "(default)"}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Lore (description)" hint="Summoners read this to decide when to call the hero">
            <textarea rows={3} value={doc.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>Equipment</h2>
        </div>
        <div className="gear-legend">
          <div>
            <span className="lg solid" />
            <span>
              <b>Equipped</b> — preloaded: the whole skill is in the hero's head from the start (<code>skills:</code> in the agent file).
            </span>
          </div>
          <div>
            <span className="lg ghost" />
            <span>
              <b>On demand</b> — not preloaded: the hero's orders tell it to load the skill with the Skill tool when it needs it. Drawn
              see-through. Click to equip it instead.
            </span>
          </div>
        </div>
        <div className="slots">
          {GEAR_SLOTS.map((slot) => {
            const g = app.gear.find((x) => x.slot === slot);
            return (
              <button
                key={slot}
                className={`slot ${g ? (g.ghost ? "ghost" : "filled") : ""}`}
                onClick={() => g && toggleSkill(g.skill)}
                title={
                  !g
                    ? "Empty"
                    : g.ghost
                      ? `On demand: the orders load ${g.skill} with the Skill tool. Click to equip (preload) it.`
                      : `Equipped (preloaded). Click to unequip ${g.skill}.`
                }
              >
                <span className="slot-name">{slot}</span>
                {g ? <SkillIcon skill={g.skill} scale={3} /> : <span className="slot-empty" />}
                <span className="slot-skill">{g?.skill ?? "—"}</span>
                {g?.ghost && <span className="slot-tag">on demand</span>}
              </button>
            );
          })}
        </div>
        {unknownEquipped.length > 0 && (
          <div className="warn-box">Equipped but not found in any scope: {unknownEquipped.join(", ")}. It may live in the project the hero runs in.</div>
        )}
        <h3>Inventory</h3>
        <div className="inventory">
          {skillNames.map((n) => {
            const on = doc.skills.includes(n);
            return (
              <button key={n} className={`inv-item ${on ? "on" : ""}`} onClick={() => toggleSkill(n)} title={on ? "Unequip" : "Equip"}>
                <SkillIcon skill={n} />
                <span>{n}</span>
                {onDemand.includes(n) && (
                  <span className="badge info" title="Not equipped, but the orders load it with the Skill tool while working">
                    on demand
                  </span>
                )}
                {unreachable.includes(n) && (
                  <span className="badge warn" title="Named in the orders, but the hero's tools don't include Skill, so it can't load it">
                    named, no Skill tool
                  </span>
                )}
              </button>
            );
          })}
          {!skillNames.length && <span className="sub">No skills yet — visit the Skill Shrine.</span>}
        </div>
      </div>

      <div className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>Abilities</h2>
          <span className="sub">⚔ {WEAPON_INFO[app.weapon]}</span>
        </div>
        <div className="chips">
          {COMMON_TOOLS.map((t) => (
            <span key={t} className={`chip ${tools.includes(t) ? "on" : ""}`} onClick={() => toggleTool(t)}>
              {t}
            </span>
          ))}
        </div>
        <input value={doc.tools ?? ""} onChange={(e) => set({ tools: e.target.value })} placeholder="(empty = every tool)" className="mono" />
        {Object.keys(doc.extra).length > 0 && (
          <div className="sub">
            Other frontmatter kept as-is: <code>{Object.keys(doc.extra).join(", ")}</code>
          </div>
        )}
      </div>

      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Orders (system prompt)</h2>
        <textarea rows={22} value={doc.body} onChange={(e) => set({ body: e.target.value })} />
      </div>
    </div>
  );
}

function ClassSelect({ value, onChange }: { value?: string; onChange: (m: string | undefined) => void }) {
  const known = CLASSES.some((c) => c.model === (value ?? ""));
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        sfx("click");
        onChange(e.target.value || undefined);
      }}
    >
      {CLASSES.map((c) => (
        <option key={c.model} value={c.model}>
          {c.label}
        </option>
      ))}
      {!known && <option value={value}>{value}</option>}
    </select>
  );
}
