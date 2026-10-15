import { useEffect, useState } from "react";
import type { SkillDoc } from "../../shared/types";
import { api } from "../api";
import { go } from "../App";
import { HeroSprite, SkillIcon } from "../components/Sprite";
import { ErrorBox, Field, ScopeBadge, slugify, useAsync, useScopes } from "../components/ui";
import { useHeroes, type Hero } from "../game/heroes";
import { sfx } from "../game/sfx";

const blank = (): SkillDoc => ({
  scope: "user",
  dir: "",
  name: "",
  description: "",
  extra: {},
  body: "# Skill title\n\nWhat this skill does, step by step. Reference supporting files by relative path.\n",
  files: [],
  path: "",
});

export function SkillsPage({ params }: { params: string[] }) {
  const { data: skills, error, reload } = useAsync(() => api.skills());
  const { heroes } = useHeroes();
  const scopes = useScopes();
  const holders = (name: string) => heroes.filter((h) => h.agent?.skills.includes(name));
  const [filter, setFilter] = useState("");
  const [scope, dir] = params;
  const selected = skills?.find((s) => s.scope === scope && s.dir === dir);
  const shown = (skills ?? []).filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Skill Shrine</h1>
        <span className="sub">Spellbooks from each scope's skills/&lt;name&gt;/SKILL.md — equip them on heroes in the Hero Hall</span>
        <span className="spacer" />
        <button
          className="primary"
          onClick={() => {
            sfx("select");
            go("skills", "new");
          }}
        >
          + Inscribe skill
        </button>
      </div>
      <ErrorBox error={error} />
      <div className="split">
        <div className="list">
          <input placeholder="Search the grimoire…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {shown.map((s) => (
            <button
              key={s.path}
              className={`list-item hero-item ${s === selected ? "active" : ""}`}
              onClick={() => {
                sfx("click");
                go("skills", s.scope, s.dir);
              }}
            >
              <SkillIcon skill={s.name} scale={3} />
              <div style={{ minWidth: 0 }}>
              <div className="title">
                {s.name}
                {holders(s.name).length > 0 && <span className="lv">×{holders(s.name).length}</span>}
                <ScopeBadge scope={s.scope} scopes={scopes} />
                {s.files.length > 0 && <span className="badge">+{s.files.length} files</span>}
              </div>
              <div className="desc">{s.description}</div>
              </div>
            </button>
          ))}
          {skills && !shown.length && <div className="empty">The grimoire is empty</div>}
        </div>
        <div>
          {scope === "new" ? (
            <SkillEditor key="new" initial={blank()} isNew onSaved={(s) => reload().then(() => go("skills", s.scope, s.dir))} />
          ) : selected ? (
            <SkillEditor key={selected.path} initial={selected} holders={holders(selected.name)} onSaved={() => reload()} onDeleted={() => reload().then(() => go("skills"))} />
          ) : (
            <div className="empty">Pick a spellbook, or inscribe a new skill.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillEditor({
  initial,
  isNew,
  holders = [],
  onSaved,
  onDeleted,
}: {
  initial: SkillDoc;
  isNew?: boolean;
  holders?: Hero[];
  onSaved: (s: SkillDoc) => void;
  onDeleted?: () => void;
}) {
  const scopes = useScopes();
  const [doc, setDoc] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const dirty = JSON.stringify(doc) !== JSON.stringify(initial);
  const set = (patch: Partial<SkillDoc>) => setDoc((d) => ({ ...d, ...patch }));

  useEffect(() => {
    if (isNew) setDoc((d) => ({ ...d, dir: slugify(d.name) }));
  }, [doc.name, isNew]);

  const save = async () => {
    setError(null);
    try {
      const out = await api.saveSkill(doc);
      setDoc(out);
      sfx("save");
      onSaved(out);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete skill "${doc.name}" and its whole directory? A backup is kept in data/backups.`)) return;
    await api.deleteSkill(doc.scope, doc.dir).catch((e: Error) => setError(e.message));
    onDeleted?.();
  };
  const open = async (path: string) => {
    try {
      setPreview({ path, ...(await api.skillFile(doc.scope, doc.dir, path)) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="panel stack">
      <div className="row">
        <SkillIcon skill={doc.name || "new"} scale={4} />
        <h2 style={{ margin: 0 }}>{isNew ? "New skill" : doc.name}</h2>
        {!isNew && <span className="sub mono">{initial.path}</span>}
        <span style={{ flex: 1 }} />
        {!isNew && (
          <button className="danger" onClick={remove}>
            Destroy
          </button>
        )}
        <button className="primary" onClick={save} disabled={!dirty && !isNew}>
          Save
        </button>
      </div>
      <ErrorBox error={error} />
      {!isNew && (
        <div className="row" style={{ gap: 4 }}>
          <span className="sub">Carried by:</span>
          {holders.map((h) => (
            <button key={h.key} className="ghost small holder" onClick={() => go("agents", h.agent!.scope, h.agent!.file)} title={h.title}>
              <HeroSprite app={h.app} scale={1} />
              {h.title}
            </button>
          ))}
          {!holders.length && <span className="sub">nobody yet — equip it on a hero in the Hero Hall</span>}
        </div>
      )}
      <div className="grid2">
        <Field label="Name">
          <input value={doc.name} onChange={(e) => set({ name: e.target.value })} placeholder="release-notes" />
        </Field>
        {isNew && (
          <div className="grid2">
            <Field label="Scope">
              <select value={doc.scope} onChange={(e) => set({ scope: e.target.value })}>
                {scopes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Directory">
              <input value={doc.dir} onChange={(e) => set({ dir: e.target.value })} />
            </Field>
          </div>
        )}
      </div>
      <Field label="Description" hint="The trigger: Claude loads the skill when a request matches this text">
        <textarea rows={4} value={doc.description} onChange={(e) => set({ description: e.target.value })} style={{ fontFamily: "inherit" }} />
      </Field>
      {Object.keys(doc.extra).length > 0 && (
        <div className="sub">
          Other frontmatter kept as-is: <code>{Object.keys(doc.extra).join(", ")}</code>
        </div>
      )}
      <Field label="SKILL.md body">
        <textarea rows={24} value={doc.body} onChange={(e) => set({ body: e.target.value })} />
      </Field>
      {doc.files.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Supporting files</h3>
          <div className="chips">
            {doc.files.map((f) => (
              <span key={f} className={`chip mono ${preview?.path === f ? "on" : ""}`} onClick={() => open(f)}>
                {f}
              </span>
            ))}
          </div>
          {preview && <pre className="output">{preview.content}</pre>}
        </div>
      )}
    </div>
  );
}
