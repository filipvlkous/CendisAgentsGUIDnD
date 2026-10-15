import type { StepStatus, WorkflowStep } from "../../shared/types";

const W = 196;
const H = 58;
const GX = 64;
const GY = 18;
const PAD = 16;

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: "var(--muted)",
  running: "var(--info)",
  waiting: "var(--warn)",
  done: "var(--ok)",
  failed: "var(--err)",
  skipped: "var(--warn)",
  cancelled: "var(--warn)",
};

/** Lays steps out in columns by dependency depth and draws the edges between them. */
export function DagView({
  steps,
  statuses,
  selected,
  onSelect,
  portraits,
}: {
  portraits?: Record<string, string>; // agent name ("" = default) → sprite data URL
  steps: WorkflowStep[];
  statuses?: Record<string, StepStatus>;
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0; // cycle: the editor reports it; just keep drawing
    seen.add(id);
    const deps = (byId.get(id)?.dependsOn ?? []).filter((d) => byId.has(d));
    const d = deps.length ? Math.max(...deps.map((x) => depthOf(x, seen))) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  steps.forEach((s) => depthOf(s.id));

  const columns: string[][] = [];
  steps.forEach((s) => (columns[depth.get(s.id)!] ??= []).push(s.id));
  const pos = new Map<string, { x: number; y: number }>();
  const tallest = Math.max(1, ...columns.map((c) => c?.length ?? 0));
  const height = PAD * 2 + tallest * H + (tallest - 1) * GY;
  columns.forEach((col, ci) => {
    const colH = col.length * H + (col.length - 1) * GY;
    col.forEach((id, ri) => pos.set(id, { x: PAD + ci * (W + GX), y: (height - colH) / 2 + ri * (H + GY) }));
  });
  const width = PAD * 2 + columns.length * W + Math.max(0, columns.length - 1) * GX;

  if (!steps.length) return <div className="empty">No steps yet</div>;

  return (
    <div className="dag">
      <svg width={width} height={height} role="img" aria-label="Workflow graph">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {steps.flatMap((s) =>
          s.dependsOn
            .filter((d) => pos.has(d))
            .map((d) => {
              const a = pos.get(d)!;
              const b = pos.get(s.id)!;
              const x1 = a.x + W;
              const y1 = a.y + H / 2;
              const x2 = b.x - 2;
              const y2 = b.y + H / 2;
              const mx = (x1 + x2) / 2;
              return <path key={`${d}-${s.id}`} className="edge" d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} markerEnd="url(#arrow)" />;
            }),
        )}
        {steps.map((s) => {
          const p = pos.get(s.id)!;
          const status = statuses?.[s.id];
          return (
            <g key={s.id} className={`node ${selected === s.id ? "sel" : ""}`} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect?.(s.id)}>
              <rect width={W} height={H} rx={0} />
              {portraits?.[s.agent] && (
                <image href={portraits[s.agent]} x={6} y={3} width={36} height={42} style={{ imageRendering: "pixelated" }} className={status === "running" ? "pulse" : ""} />
              )}
              {status && <rect width={4} height={H - 16} x={0} y={8} rx={2} style={{ fill: STATUS_COLOR[status], stroke: "none" }} className={status === "running" || status === "waiting" ? "pulse" : ""} />}
              <text x={portraits?.[s.agent] ? 48 : 14} y={22}>{clip(s.name || s.id, portraits ? 18 : 22)}</text>
              <text x={portraits?.[s.agent] ? 48 : 14} y={42} className="sub">
                {clip(s.agent || "Claude", 16)}
                {status ? ` · ${status}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
