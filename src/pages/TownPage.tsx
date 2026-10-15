import { useEffect, useMemo, useRef, useState } from "react";
import type { PermissionMode, Run } from "../../shared/types";
import { api } from "../api";
import { go } from "../App";
import { HeroSprite, SkillIcon } from "../components/Sprite";
import { ErrorBox, useAsync } from "../components/ui";
import { heroForAgentName, quips, useHeroes, type Hero } from "../game/heroes";
import { levelFor, XP_WIN } from "../game/progress";
import { sfx } from "../game/sfx";
import { CLASS_INFO, hash, heroFrame, PAL, WEAPON_INFO } from "../game/sprite";
import { blocked, BUILDINGS, drawAnimated, drawBackground, randomFieldPoint, rng, SIGNPOST, TENT, WH, WW } from "../game/world";

interface Ent {
  x: number;
  y: number;
  tx: number;
  ty: number;
  wait: number;
  flip: boolean;
  moving: boolean;
  cheerUntil: number;
  nextChat: number;
}

type Bubble = { text: string; until: number; kind: "talk" | "quest" | "win" | "fail" | "level" | "ask" };

const SPEED = { wander: 14, quest: 34, control: 48 };

export function TownPage() {
  const { heroes, runs, error, reloadRuns } = useHeroes();
  const workflows = useAsync(() => api.workflows()).data ?? [];
  const questLogState = useAsync(() => api.quests());
  const questLog = questLogState.data;
  const openQuests = questLog?.quests.length ?? 0;
  const openQuestsRef = useRef(0);
  openQuestsRef.current = openQuests;
  const settings = useAsync(() => api.settings()).data;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const ents = useRef(new Map<string, Ent>());
  const heroesRef = useRef<Hero[]>([]);
  const keys = useRef(new Set<string>());
  const questing = useRef(new Map<string, string>()); // hero name → run id
  const [selected, setSelected] = useState<string | null>(null);
  const [controlled, setControlled] = useState<string | null>(null);
  const controlledRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;
  const [doorHint, setDoorHint] = useState<{ label: string; route: string } | null>(null);
  const doorRef = useRef<{ label: string; route: string } | null>(null);
  const [activeRuns, setActiveRuns] = useState<Run[]>([]);
  // heroes blocked on a question: hero name → where to answer
  const [asking, setAsking] = useState<{ name: string; runId: string; stepId: string; question: string }[]>([]);
  const askedRef = useRef(new Set<string>());
  const bgRef = useRef<HTMLCanvasElement | null>(null);

  heroesRef.current = heroes;
  controlledRef.current = controlled;
  selectedRef.current = selected;

  const say = (key: string, text: string, kind: Bubble["kind"] = "talk", ms = 4000) =>
    setBubbles((b) => ({ ...b, [key]: { text, kind, until: Date.now() + ms } }));

  // background is redrawn when the number of your quests (notes on the board) changes
  useEffect(() => {
    bgRef.current = drawBackground(openQuests);
  }, [openQuests]);

  // keep one entity per hero
  useEffect(() => {
    const m = ents.current;
    for (const h of heroes) {
      if (m.has(h.key)) continue;
      const p = randomFieldPoint(rng(hash(h.key)));
      m.set(h.key, { x: p.x, y: p.y, tx: p.x, ty: p.y, wait: 1 + Math.random() * 3, flip: false, moving: false, cheerUntil: 0, nextChat: Date.now() + 5000 + Math.random() * 20000 });
    }
    for (const k of [...m.keys()]) if (!heroes.some((h) => h.key === k)) m.delete(k);
  }, [heroes]);

  // poll running quests: heroes on a quest walk to the board and narrate their latest action
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const summaries = await api.runs();
        const running = await Promise.all(
          summaries.filter((r) => r.status === "running" || r.status === "waiting").map((r) => api.run(r.id)),
        );
        if (stop) return;
        setActiveRuns(running);
        const now = new Map<string, string>();
        const asks: typeof asking = [];
        for (const run of running) {
          for (const step of run.steps) {
            const sr = run.stepRuns[step.id];
            if (sr.status === "waiting") {
              // still on the mission, but stuck: a "?" bubble until you answer
              now.set(step.agent, run.id);
              const question = sr.questions?.[0] ?? "I'm stuck — I need your help.";
              asks.push({ name: step.agent, runId: run.id, stepId: step.id, question });
              const hero = heroForAgentName(heroesRef.current, step.agent);
              const id = `${run.id}/${step.id}/${sr.turns ?? 0}`;
              if (hero) say(hero.key, `❓ ${question.length > 90 ? question.slice(0, 88) + "…" : question}`, "ask", 6000);
              if (!askedRef.current.has(id)) {
                askedRef.current.add(id);
                sfx("ask");
              }
              continue;
            }
            if (sr.status !== "running") continue;
            now.set(step.agent, run.id);
            const hero = heroForAgentName(heroesRef.current, step.agent);
            const last = [...sr.events].reverse().find((e) => e.kind === "text" || e.kind === "tool");
            if (hero && last) {
              const text = last.kind === "text" ? last.text : `⚒ ${last.name} ${last.input}`;
              say(hero.key, text.length > 80 ? text.slice(0, 78) + "…" : text, "quest", 6000);
            }
          }
        }
        setAsking(asks);
        // heroes whose quest just ended
        for (const [name, runId] of questing.current) {
          if (now.has(name)) continue;
          const hero = heroForAgentName(heroesRef.current, name);
          const done = summaries.find((s) => s.id === runId);
          const step = done?.agentResults.find((r) => r.agent === name);
          if (hero) {
            const won = step?.status === "done";
            const before = hero.stats.level;
            const after = levelFor(hero.stats.xp + (won ? XP_WIN : 2));
            if (after > before) {
              say(hero.key, `LEVEL UP! Now level ${after}!`, "level", 6000);
              sfx("levelup");
            } else {
              say(hero.key, won ? `Quest complete! +${XP_WIN} XP` : "Quest failed… I'll be back.", won ? "win" : "fail", 5000);
              sfx(won ? "win" : "fail");
            }
            const e = ents.current.get(hero.key);
            if (e && won) e.cheerUntil = Date.now() + 2500;
          }
        }
        if (questing.current.size && [...questing.current.keys()].some((k) => !now.has(k))) void reloadRuns();
        questing.current = now;
      } catch {
        // server unavailable: try again next tick
      }
    };
    void poll();
    const t = setInterval(poll, 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [reloadRuns]);

  // keyboard control
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || !controlledRef.current) return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
        keys.current.add(k);
        e.preventDefault();
      }
      if ((k === "e" || k === "enter") && doorRef.current) {
        sfx("select");
        go(doorRef.current.route);
      }
      if (k === "escape") setControlled(null);
      if (k === " ") {
        const h = heroesRef.current.find((x) => x.key === controlledRef.current);
        if (h) talk(h);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // game loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let stepSound = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || !bgRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const wall = Date.now();

      const questers = [...questing.current.keys()];

      for (const h of heroesRef.current) {
        const e = ents.current.get(h.key);
        if (!e) continue;
        let vx = 0;
        let vy = 0;
        let speed = SPEED.wander;
        if (controlledRef.current === h.key) {
          const k = keys.current;
          if (k.has("arrowleft") || k.has("a")) vx -= 1;
          if (k.has("arrowright") || k.has("d")) vx += 1;
          if (k.has("arrowup") || k.has("w")) vy -= 1;
          if (k.has("arrowdown") || k.has("s")) vy += 1;
          speed = SPEED.control;
          e.tx = e.x;
          e.ty = e.y;
        } else {
          const qi = questers.indexOf(h.name);
          if (qi >= 0) {
            // gather around the war table tent
            e.tx = TENT.x - 16 + (qi % 4) * 11;
            e.ty = TENT.y + 6 + Math.floor(qi / 4) * 9;
            speed = SPEED.quest;
            e.wait = 0;
          } else if (e.wait > 0) {
            e.wait -= dt;
            if (e.wait <= 0) {
              const p = randomFieldPoint(Math.random);
              e.tx = p.x;
              e.ty = p.y;
            }
          }
          const dx = e.tx - e.x;
          const dy = e.ty - e.y;
          const d = Math.hypot(dx, dy);
          if (d > 1) {
            vx = dx / d;
            vy = dy / d;
          } else if (e.wait <= 0 && qi < 0) {
            e.wait = 1.5 + Math.random() * 4;
          }
          // ambient chatter
          if (wall > e.nextChat && qi < 0 && controlledRef.current !== h.key) {
            e.nextChat = wall + 25000 + Math.random() * 35000;
            // never talk over a quest report, and keep the town readable
            const talking = Object.values(bubblesRef.current).filter((b) => b.until > wall);
            if (bubblesRef.current[h.key]?.until > wall || talking.length >= 2) continue;
            const lines = quips(h);
            say(h.key, lines[Math.floor(Math.random() * lines.length)], "talk", 3500);
          }
        }
        const len = Math.hypot(vx, vy);
        e.moving = len > 0;
        if (len > 0) {
          const nx = e.x + (vx / len) * speed * dt;
          const ny = e.y + (vy / len) * speed * dt;
          const free = controlledRef.current === h.key ? (x: number, y: number) => !blocked(x, y) : () => true;
          if (free(nx, e.y)) e.x = nx;
          if (free(e.x, ny)) e.y = ny;
          if (Math.abs(vx) > 0.2) e.flip = vx < 0;
          if (controlledRef.current === h.key && now - stepSound > 280) {
            stepSound = now;
            sfx("step");
          }
        }
      }

      // door detection for the controlled hero
      const ce = controlledRef.current ? ents.current.get(controlledRef.current) : undefined;
      let door: { label: string; route: string } | null = null;
      if (ce) {
        const b = BUILDINGS.find((b) => ce.y < 86 && Math.abs(ce.x - b.doorX) < 14);
        if (b) door = { label: b.label, route: b.route };
        else if (Math.hypot(ce.x - SIGNPOST.x, ce.y - SIGNPOST.y) < 12) door = { label: SIGNPOST.label, route: SIGNPOST.route };
        else if (Math.abs(ce.x - TENT.x) < 10 && ce.y >= TENT.y && ce.y < TENT.y + 8) door = { label: TENT.label, route: TENT.route };
      }
      if (door?.route !== doorRef.current?.route) {
        doorRef.current = door;
        setDoorHint(door);
      }

      // draw
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bgRef.current, 0, 0);
      drawAnimated(ctx, now, questers.length, openQuestsRef.current);
      const order = heroesRef.current
        .map((h) => ({ h, e: ents.current.get(h.key)! }))
        .filter((x) => x.e)
        .sort((a, b) => a.e.y - b.e.y);
      for (const { h, e } of order) {
        const sel = selectedRef.current === h.key;
        if (sel || controlledRef.current === h.key) {
          ctx.fillStyle = controlledRef.current === h.key ? PAL.sand : PAL.white;
          for (let i = -7; i <= 7; i++) {
            const yy = Math.round(Math.sqrt(1 - (i / 8) ** 2) * 3);
            ctx.fillRect(Math.round(e.x + i), Math.round(e.y - 1 + yy), 1, 1);
            ctx.fillRect(Math.round(e.x + i), Math.round(e.y - 1 - yy), 1, 1);
          }
        }
        const cheering = wall < e.cheerUntil;
        const frame = cheering ? (Math.floor(now / 200) % 2 ? 3 : 0) : e.moving ? 1 + (Math.floor(now / 160) % 2) : 0;
        const bob = !e.moving && !cheering && Math.floor(now / 500 + (hash(h.key) % 7)) % 2 ? 1 : 0;
        const img = heroFrame(h.app, frame);
        const sx = Math.round(e.x - 12);
        const sy = Math.round(e.y - 27 + bob);
        if (e.flip) {
          ctx.save();
          ctx.translate(sx + 24, sy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
          ctx.restore();
        } else ctx.drawImage(img, sx, sy);

        const label = labelRefs.current.get(h.key);
        if (label) {
          label.style.left = `${(e.x / WW) * 100}%`;
          label.style.top = `${((e.y - 30) / WH) * 100}%`;
          label.style.zIndex = String(Math.round(e.y));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // expire bubbles
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setBubbles((b) => {
        const live = Object.entries(b).filter(([, v]) => v.until > now);
        return live.length === Object.keys(b).length ? b : Object.fromEntries(live);
      });
    }, 500);
    return () => clearInterval(t);
  }, []);

  const talk = (h: Hero) => {
    const lines = quips(h);
    say(h.key, lines[Math.floor(Math.random() * lines.length)]);
    sfx("talk");
    const e = ents.current.get(h.key);
    if (e) e.cheerUntil = Date.now() + 600;
  };

  const onCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * WW;
    const y = ((ev.clientY - rect.top) / rect.height) * WH;
    const hit = heroesRef.current
      .map((h) => ({ h, e: ents.current.get(h.key) }))
      .filter(({ e }) => e && Math.abs(x - e.x) < 9 && y < e.y + 2 && y > e.y - 27)
      .sort((a, b) => b.e!.y - a.e!.y)[0];
    if (hit) {
      setSelected(hit.h.key);
      sfx("select");
      talk(hit.h);
      return;
    }
    const b = BUILDINGS.find((b) => x >= b.x && x <= b.x + b.w && y < 76);
    if (b) {
      sfx("select");
      go(b.route);
      return;
    }
    if (Math.abs(x - SIGNPOST.x) < 10 && y > SIGNPOST.y - 16 && y < SIGNPOST.y + 2) {
      go(SIGNPOST.route);
      return;
    }
    if (Math.abs(x - TENT.x) < TENT.w / 2 && y > TENT.y - TENT.h - 6 && y < TENT.y + 2) {
      sfx("select");
      go(TENT.route);
      return;
    }
    // click on the ground moves the controlled hero there
    const ce = controlled && ents.current.get(controlled);
    if (ce && !blocked(x, y)) {
      ce.tx = x;
      ce.ty = y;
    }
  };

  const hero = heroes.find((h) => h.key === selected);
  const activeCount = new Set(activeRuns.flatMap((r) => r.steps.filter((s) => r.stepRuns[s.id].status === "running").map((s) => s.agent))).size;

  return (
    <div className="page town-page">
      <div className="page-head">
        <h1>Guild Town</h1>
        <span className="sub">
          {questLog
            ? `${openQuests} open quest${openQuests === 1 ? "" : "s"} for you on the board`
            : questLogState.loading
              ? "checking the Quest Board…"
              : "Quest Board not connected"} · {heroes.length}{" "}
          heroes · {workflows.length} campaigns · {activeCount ? `${activeCount} hero${activeCount === 1 ? "" : "es"} on a mission` : "heroes idle"}
        </span>
      </div>
      <ErrorBox error={error} />
      <div className="town-layout">
        <div className="town-wrap panel">
          <div className="town">
            <canvas ref={canvasRef} width={WW} height={WH} className="pixel town-canvas" onClick={onCanvasClick} />
            {BUILDINGS.map((b) => (
              <button
                key={b.id}
                className="town-sign"
                style={{ left: `${(b.doorX / WW) * 100}%`, top: `${(1 / WH) * 100}%` }}
                onClick={() => {
                  sfx("select");
                  go(b.route);
                }}
                title={b.hint}
              >
                {b.label}
              </button>
            ))}
            <button
              className="town-sign"
              style={{ left: `${(TENT.x / WW) * 100}%`, top: `${((TENT.y + 3) / WH) * 100}%` }}
              onClick={() => {
                sfx("select");
                go(TENT.route);
              }}
              title="Plan agent campaigns (workflows)"
            >
              {TENT.label}
            </button>
            {heroes.map((h) => {
              const bubble = bubbles[h.key];
              return (
                <div
                  key={h.key}
                  className="town-label"
                  ref={(el) => {
                    if (el) labelRefs.current.set(h.key, el);
                    else labelRefs.current.delete(h.key);
                  }}
                >
                  {bubble && <div className={`bubble ${bubble.kind}`}>{bubble.text}</div>}
                  <div className={`nameplate ${selected === h.key ? "sel" : ""}`}>
                    {h.title} <span className="lv">Lv{h.stats.level}</span>
                  </div>
                </div>
              );
            })}
            {doorHint && <div className="door-hint">Press E to enter {doorHint.label}</div>}
          </div>
          <div className="town-help">
            {controlled
              ? "Arrows/WASD move · Space talk · E enter building · Esc release · click ground to walk"
              : "Click a hero to talk · click a building to enter · take control of a hero to walk around"}
          </div>
        </div>
        <aside className="town-side stack">
          {asking.length > 0 && (
            <div className="panel need-you">
              <h2 style={{ margin: 0 }}>❓ Heroes need you ({asking.length})</h2>
              {asking.map((a) => {
                const h = heroForAgentName(heroes, a.name);
                return (
                  <button
                    key={`${a.runId}/${a.stepId}`}
                    onClick={() => {
                      sfx("select");
                      go("runs", a.runId);
                    }}
                  >
                    {h && <HeroSprite app={h.app} scale={1} />}
                    <span>
                      <b>{h?.title ?? (a.name || "Claude")}:</b> {a.question.length > 120 ? a.question.slice(0, 118) + "…" : a.question}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {hero ? (
            <HeroCard
              key={hero.key}
              hero={hero}
              controlled={controlled === hero.key}
              onControl={() => {
                sfx("select");
                setControlled(controlled === hero.key ? null : hero.key);
              }}
              onTalk={() => talk(hero)}
              defaultCwd={settings?.projects[0] ?? ""}
              onQuest={(run) => {
                questing.current.set(hero.name, run.id);
                say(hero.key, "To the war table!", "quest");
                sfx("quest");
              }}
              busy={questing.current.has(hero.name)}
            />
          ) : (
            <div className="panel stack">
              <h2>Welcome, guildmaster</h2>
              <p className="sub">
                Every agent in your <code>.claude</code> folders lives here as a hero. Their class comes from the model, their weapon
                from their tools, and each equipped skill adds a piece of gear.
              </p>
              <p className="sub">
                The Quest Board holds your own quests from Jira. Click a hero to inspect them, send them on a mission, or take
                control.
              </p>
              <div className="roster">
                {heroes.map((h) => (
                  <button key={h.key} className="roster-item" onClick={() => setSelected(h.key)} title={h.title}>
                    <HeroSprite app={h.app} scale={2} />
                    <span>{h.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
      {runs.length > 0 && <div className="sub" style={{ marginTop: 10 }}>Hero missions in the chronicle: {runs.length}</div>}
    </div>
  );
}

function HeroCard({
  hero,
  controlled,
  onControl,
  onTalk,
  onQuest,
  defaultCwd,
  busy,
}: {
  hero: Hero;
  controlled: boolean;
  onControl: () => void;
  onTalk: () => void;
  onQuest: (run: Run) => void;
  defaultCwd: string;
  busy: boolean;
}) {
  const [questOpen, setQuestOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState(defaultCwd);
  const [mode, setMode] = useState<PermissionMode>("plan");
  const [error, setError] = useState<string | null>(null);
  const s = hero.stats;
  const pct = Math.round(((s.xp - s.floor) / Math.max(1, s.next - s.floor)) * 100);
  const info = CLASS_INFO[hero.app.cls];
  const sheet = useMemo(() => (hero.agent ? () => go("agents", hero.agent!.scope, hero.agent!.file) : null), [hero]);

  useEffect(() => setCwd((c) => c || defaultCwd), [defaultCwd]);

  const embark = async () => {
    setError(null);
    try {
      const run = await api.runAgent({ agent: hero.name, prompt, cwd, model: "", permissionMode: mode });
      onQuest(run);
      setQuestOpen(false);
      setPrompt("");
    } catch (e) {
      setError((e as Error).message);
      sfx("fail");
    }
  };

  return (
    <div className="panel stack hero-card">
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="portrait">
          <HeroSprite app={hero.app} scale={4} cheer={busy} />
        </div>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{hero.title}</h2>
          <div className="sub">
            Lv {s.level} {info.label}
          </div>
          <div className="xpbar" title={`${s.xp} XP`}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="sub">
            {s.xp} XP · {s.questsWon} won · {s.questsLost} lost
          </div>
        </div>
      </div>
      <div className="sub">{info.blurb}</div>
      <div className="sub">⚔ {WEAPON_INFO[hero.app.weapon]}</div>
      {hero.app.gear.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {hero.app.gear.map((g) => (
            <div key={g.skill} className="row" style={{ gap: 6 }}>
              <SkillIcon skill={g.skill} />
              <span>{g.skill}</span>
              <span className="badge">{g.slot}</span>
              {g.ghost && <span className="badge info">on demand</span>}
            </div>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
      <div className="row">
        <button onClick={onTalk}>Talk</button>
        <button className={controlled ? "primary" : ""} onClick={onControl}>
          {controlled ? "Release" : "Take control"}
        </button>
        {sheet && <button onClick={sheet}>Character sheet</button>}
        <button className="primary" onClick={() => setQuestOpen(!questOpen)} disabled={busy}>
          {busy ? "On a mission…" : "Send on mission"}
        </button>
      </div>
      {questOpen && (
        <div className="stack quest-form">
          <textarea rows={4} placeholder="Describe the mission…" value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus />
          <input className="mono" placeholder="Working directory (repo)" value={cwd} onChange={(e) => setCwd(e.target.value)} />
          <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
            <option value="plan">Scout (plan — read-only)</option>
            <option value="acceptEdits">Builder (acceptEdits)</option>
            <option value="default">Cautious (default)</option>
            <option value="bypassPermissions">Berserk (bypassPermissions)</option>
          </select>
          <button className="primary" disabled={!prompt.trim() || !cwd.trim()} onClick={embark}>
            Embark!
          </button>
        </div>
      )}
    </div>
  );
}
