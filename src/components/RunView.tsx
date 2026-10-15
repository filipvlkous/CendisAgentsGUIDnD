import { useEffect, useRef, useState } from "react";
import type { Run, RunMessage, StepEvent, StepRun } from "../../shared/types";
import { api } from "../api";
import { go } from "../App";
import { heroForAgentName, useHeroes, usePortraits } from "../game/heroes";
import { sfx } from "../game/sfx";
import { DagView } from "./DagView";
import { HeroSprite } from "./Sprite";
import { ErrorBox, fmtCost, fmtDuration, StatusBadge } from "./ui";

/** Subscribes to a run's event stream and keeps a live copy of it. */
function useLiveRun(id: string) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRun(null);
    const es = new EventSource(`/api/runs/${encodeURIComponent(id)}/stream`);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as RunMessage;
      setRun((prev) => apply(prev, msg));
    };
    es.onerror = () => {
      es.close();
      // The stream closes normally once a finished run's snapshot is sent; only report if we got nothing.
      setRun((prev) => {
        if (!prev) setError("Could not load run");
        return prev;
      });
    };
    return () => es.close();
  }, [id]);
  return { run, error };
}

function apply(run: Run | null, msg: RunMessage): Run | null {
  if (msg.type === "snapshot") return msg.run;
  if (!run) return run;
  if (msg.type === "status") return { ...run, status: msg.status, finishedAt: msg.finishedAt };
  const sr = run.stepRuns[msg.stepId];
  const next =
    msg.type === "step" ? { ...sr, ...msg.patch } : { ...sr, events: [...sr.events, msg.event] };
  return { ...run, stepRuns: { ...run.stepRuns, [msg.stepId]: next } };
}

export function RunView({ id }: { id: string }) {
  const { run, error } = useLiveRun(id);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"output" | "log" | "prompt">("log");
  const [, tick] = useState(0);
  const { heroes } = useHeroes();
  const portraits = usePortraits(heroes);
  const lastStatus = useRef<string | null>(null);

  // fanfare when a run you are watching finishes
  useEffect(() => {
    if (!run) return;
    if (lastStatus.current === "running" && run.status === "waiting") sfx("ask");
    else if (lastStatus.current === "running" && run.status !== "running") sfx(run.status === "done" ? "win" : "fail");
    lastStatus.current = run.status;
  }, [run?.status]);

  useEffect(() => {
    if (run?.status !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [run?.status]);

  if (error) return <ErrorBox error={error} />;
  if (!run) return <div className="sub">Loading…</div>;

  const current =
    selected ??
    run.steps.find((s) => run.stepRuns[s.id].status === "waiting")?.id ??
    run.steps.find((s) => run.stepRuns[s.id].status === "running")?.id ??
    run.steps[0]?.id;
  const waitingSteps = run.steps.filter((s) => run.stepRuns[s.id].status === "waiting");
  const step = run.steps.find((s) => s.id === current);
  const sr = current ? run.stepRuns[current] : undefined;
  const total = Object.values(run.stepRuns).reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const statuses = Object.fromEntries(Object.entries(run.stepRuns).map(([k, v]) => [k, v.status]));

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>{run.workflowName}</h1>
        <StatusBadge status={run.status} />
        <span className="sub">
          {fmtDuration(run.startedAt, run.finishedAt)} · {fmtCost(total)} · <span className="mono">{run.cwd}</span>
        </span>
        <span className="spacer" />
        {(run.status === "running" || run.status === "waiting") && (
          <button className="danger" onClick={() => api.cancelRun(run.id)}>
            Retreat!
          </button>
        )}
        {run.workflowId && (
          <button onClick={() => go("workflows", run.workflowId!)}>Open campaign</button>
        )}
      </div>

      {run.input && (
        <div className="panel">
          <h3>Quest briefing</h3>
          <div style={{ whiteSpace: "pre-wrap" }}>{run.input}</div>
        </div>
      )}

      {waitingSteps.length > 1 && (
        <div className="warn-box">
          {waitingSteps.length} stages are waiting for you: {waitingSteps.map((s) => s.name || s.id).join(", ")}. Click one in the
          graph to answer it.
        </div>
      )}

      {run.steps.length > 1 && <DagView steps={run.steps} statuses={statuses} selected={current} onSelect={setSelected} portraits={portraits} />}

      {step && sr && (
        <div className="panel stack">
          <div className="row">
            {(() => {
              const h = heroForAgentName(heroes, step.agent);
              return h ? <HeroSprite app={h.app} scale={3} walking={sr.status === "running"} cheer={sr.status === "done"} /> : null;
            })()}
            <h2 style={{ margin: 0 }}>{step.name || step.id}</h2>
            <span className="badge">{step.agent || "Claude"}</span>
            <StatusBadge status={sr.status} />
            <span className="sub">
              {fmtDuration(sr.startedAt, sr.finishedAt)} · {fmtCost(sr.costUsd)}
              {sr.sessionId && (
                <>
                  {" "}· resume: <code>claude --resume {sr.sessionId}</code>
                </>
              )}
            </span>
          </div>
          <ErrorBox error={sr.error} />
          {sr.status === "waiting" && <AskPanel key={`${step.id}-${sr.turns ?? 0}`} runId={run.id} stepId={step.id} sr={sr} heroName={step.agent || "Claude"} />}
          <div className="row">
            {(["log", "output", "prompt"] as const).map((t) => (
              <button key={t} className={`small ${tab === t ? "primary" : ""}`} onClick={() => setTab(t)}>
                {t === "log" ? `Battle log (${sr.events.length})` : t === "output" ? "Loot (output)" : "Orders (prompt)"}
              </button>
            ))}
          </div>
          {tab === "log" && <EventLog events={sr.events} live={sr.status === "running"} />}
          {tab === "output" && <div className="output">{sr.output ?? <span className="sub">No output yet</span>}</div>}
          {tab === "prompt" && <div className="output mono">{sr.prompt ?? step.prompt}</div>}
        </div>
      )}
    </div>
  );
}

/** A blocked hero's questions and refused tools, with a reply box that resumes the same session. */
function AskPanel({ runId, stepId, sr, heroName }: { runId: string; stepId: string; sr: StepRun; heroName: string }) {
  const [answer, setAnswer] = useState("");
  const [rules, setRules] = useState(() => (sr.denials ?? []).map((d) => ({ rule: d.rule, on: true })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allow = rules.filter((r) => r.on && r.rule.trim()).map((r) => r.rule.trim());

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.answerStep(runId, stepId, { answer, allow });
      sfx("quest");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const abandon = async () => {
    if (!confirm("Give up on this stage? It fails and the stages after it are skipped.")) return;
    setBusy(true);
    await api.abandonStep(runId, stepId).catch((e: Error) => setError(e.message));
  };

  return (
    <div className="ask-panel stack">
      <h2 style={{ margin: 0 }}>❓ {heroName} needs you</h2>
      <ol className="questions">
        {(sr.questions ?? []).map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
      {rules.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>Blocked tools: allow for this stage?</h3>
          {(sr.denials ?? []).map((d, i) => (
            <label key={i} className="row deny-row">
              <input
                type="checkbox"
                checked={rules[i]?.on ?? false}
                onChange={(e) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, on: e.target.checked } : r)))}
                style={{ width: "auto" }}
              />
              <input
                className="mono"
                value={rules[i]?.rule ?? ""}
                onChange={(e) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, rule: e.target.value } : r)))}
                style={{ flex: 1, width: "auto" }}
              />
              <span className="sub" title={d.input}>
                tried: {d.input.slice(0, 70)}
              </span>
            </label>
          ))}
          <span className="sub">
            Rules can be narrowed or widened before allowing (e.g. <code>Bash(git log *)</code>). They apply to this stage only; add them to
            the campaign's Allowed tools to keep them.
          </span>
        </div>
      )}
      <textarea
        rows={4}
        placeholder="Your answer… (the hero continues in the same session with full context)"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (answer.trim() || allow.length)) void send();
        }}
      />
      <ErrorBox error={error} />
      <div className="row">
        <button className="primary" disabled={busy || (!answer.trim() && !allow.length)} onClick={send}>
          {allow.length && !answer.trim() ? "Allow & continue" : "Answer & continue"}
        </button>
        <button className="danger" disabled={busy} onClick={abandon}>
          Give up on this stage
        </button>
        <span className="sub">⌘↵ to send{sr.turns ? ` · answered ${sr.turns}× so far` : ""}</span>
      </div>
    </div>
  );
}

function EventLog({ events, live }: { events: StepEvent[]; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && live) el.scrollTop = el.scrollHeight;
  }, [events.length, live]);
  if (!events.length) return <div className="sub">{live ? "Waiting for the agent…" : "No activity"}</div>;
  return (
    <div className="log" ref={ref}>
      {events.map((e, i) => {
        if (e.kind === "text") return <div key={i} className="ev text">{e.text}</div>;
        if (e.kind === "tool")
          return (
            <div key={i} className="ev tool">
              ▸ {e.name} <span style={{ color: "var(--muted)" }}>{e.input}</span>
            </div>
          );
        if (e.kind === "tool_result") return <div key={i} className={`ev tool_result ${e.isError ? "err" : ""}`}>{e.text}</div>;
        return <div key={i} className="ev log">{e.text}</div>;
      })}
      {live && <div className="ev log pulse">working…</div>}
    </div>
  );
}
