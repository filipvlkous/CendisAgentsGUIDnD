// SQLite storage for settings, workflows and runs (data/studio.db).
// Workflows and runs are stored whole as JSON documents; the extra columns exist for sorting.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.resolve(import.meta.dirname, "..", "data");

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, "studio.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS runs_started_at ON runs (started_at DESC);
`);

const readFile = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const jsonFiles = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : [];

/**
 * One-time import of the JSON files the app used before SQLite. Each imported file is
 * renamed to *.json.imported, so nothing is lost and nothing is imported twice.
 */
function importJsonFiles() {
  const imported: string[] = [];
  db.exec("BEGIN");
  try {
    const settingsFile = path.join(DATA_DIR, "settings.json");
    const settings = readFile(settingsFile);
    if (settings) {
      db.prepare("INSERT OR IGNORE INTO settings (id, data) VALUES (1, ?)").run(JSON.stringify(settings));
      imported.push(settingsFile);
    }
    const putWorkflow = db.prepare("INSERT OR IGNORE INTO workflows (id, updated_at, data) VALUES (?, ?, ?)");
    for (const file of jsonFiles(path.join(DATA_DIR, "workflows"))) {
      const wf = readFile(file) as { id?: string; updatedAt?: string } | null;
      if (!wf?.id) continue;
      putWorkflow.run(wf.id, wf.updatedAt ?? new Date().toISOString(), JSON.stringify(wf));
      imported.push(file);
    }
    const putRun = db.prepare("INSERT OR IGNORE INTO runs (id, started_at, status, data) VALUES (?, ?, ?, ?)");
    for (const file of jsonFiles(path.join(DATA_DIR, "runs"))) {
      const run = readFile(file) as { id?: string; startedAt?: number; status?: string } | null;
      if (!run?.id) continue;
      putRun.run(run.id, run.startedAt ?? 0, run.status ?? "failed", JSON.stringify(run));
      imported.push(file);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  for (const file of imported) fs.renameSync(file, `${file}.imported`);
  if (imported.length) console.log(`Imported ${imported.length} JSON file(s) into data/studio.db`);
}

importJsonFiles();
