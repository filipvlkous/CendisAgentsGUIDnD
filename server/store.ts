import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Scope, Settings } from "../shared/types.ts";
import { db } from "./db.ts";

export const DATA_DIR = path.resolve(import.meta.dirname, "..", "data");
export const USER_CLAUDE_DIR = path.join(os.homedir(), ".claude");

const DEFAULT_SETTINGS: Settings = { claudePath: "claude", projects: [], jiraEnvFile: "" };

export async function getSettings(): Promise<Settings> {
  const row = db.prepare("SELECT data FROM settings WHERE id = 1").get() as { data: string } | undefined;
  return { ...DEFAULT_SETTINGS, ...(row ? (JSON.parse(row.data) as Partial<Settings>) : {}) };
}

export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const clean: Settings = {
    claudePath: expandHome(settings.claudePath.trim()) || "claude",
    projects: [...new Set(settings.projects.map((p) => p.trim()).filter(Boolean).map((p) => path.resolve(expandHome(p))))],
    jiraEnvFile: settings.jiraEnvFile?.trim() ? path.resolve(expandHome(settings.jiraEnvFile.trim())) : "",
  };
  db.prepare("INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data").run(
    JSON.stringify(clean),
  );
  return clean;
}

export async function getScopes(): Promise<Scope[]> {
  const { projects } = await getSettings();
  return [
    { id: "user", label: "User (~/.claude)", dir: USER_CLAUDE_DIR },
    ...projects.map((root, i) => ({
      id: `p${i}`,
      label: path.basename(root),
      dir: path.join(root, ".claude"),
    })),
  ];
}

export async function getScope(id: string): Promise<Scope> {
  const scope = (await getScopes()).find((s) => s.id === id);
  if (!scope) throw new HttpError(404, `Unknown scope "${id}"`);
  return scope;
}

/** Copies a file into data/backups before it is overwritten or deleted. */
export async function backup(file: string): Promise<void> {
  try {
    await fs.access(file);
  } catch {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rel = path.relative(os.homedir(), file).replace(/[\\/]/g, "__");
  const dest = path.join(DATA_DIR, "backups", `${stamp}__${rel}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(file, dest, { recursive: true });
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function assertSafeId(id: string, what = "id"): string {
  if (!SAFE_ID.test(id) || id.includes("..")) throw new HttpError(400, `Invalid ${what}: "${id}"`);
  return id;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
