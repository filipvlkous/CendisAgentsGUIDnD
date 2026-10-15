import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Scope, StepStatus } from "../../shared/types";
import { api } from "../api";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    return fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span style={{ fontWeight: 400 }}>{hint}</span>}
    </label>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? <div className="error-box">{error}</div> : null;
}

export function useScopes() {
  return useAsync<Scope[]>(() => api.scopes()).data ?? [];
}

export function ScopeBadge({ scope, scopes }: { scope: string; scopes: Scope[] }) {
  const s = scopes.find((x) => x.id === scope);
  return <span className="badge">{scope === "user" ? "user" : (s?.label ?? scope)}</span>;
}

const STATUS_CLASS: Record<string, string> = {
  done: "ok",
  failed: "err",
  running: "info",
  waiting: "warn",
  skipped: "warn",
  cancelled: "warn",
  pending: "",
};

export function StatusBadge({ status }: { status: StepStatus | string }) {
  return <span className={`badge ${STATUS_CLASS[status] ?? ""} ${status === "running" || status === "waiting" ? "pulse" : ""}`}>{status === "waiting" ? "❓ waiting for you" : status}</span>;
}

export const AGENT_COLORS: Record<string, string> = {
  red: "#e05252",
  orange: "#e08a3c",
  yellow: "#d4b53a",
  green: "#4cae64",
  cyan: "#3cb4c4",
  blue: "#4c7fe0",
  purple: "#9a62d8",
  pink: "#d860a8",
};

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function fmtCost(usd: number | undefined) {
  return usd ? `$${usd.toFixed(usd < 0.1 ? 4 : 2)}` : "—";
}

export function fmtDuration(start?: number, end?: number) {
  if (!start) return "—";
  const s = Math.round(((end ?? Date.now()) - start) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const MODELS = ["", "inherit", "fable", "opus", "sonnet", "haiku"];
