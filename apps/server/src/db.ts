import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0, settled_at TEXT, snoozed_until TEXT, working_since TEXT,
  loop_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  thread_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (thread_id, id)
);
CREATE TABLE IF NOT EXISTS thread_rows (
  thread_id TEXT NOT NULL, record_key TEXT NOT NULL, PRIMARY KEY (thread_id, record_key)
);
CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, record_key TEXT NOT NULL, status TEXT NOT NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exclusions (record_key TEXT PRIMARY KEY, reason TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loops (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT, what TEXT NOT NULL, usd REAL NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, record_key TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT,
  body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vault (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vault_kind ON vault (kind);
CREATE INDEX IF NOT EXISTS messages_record ON messages (record_key);
CREATE INDEX IF NOT EXISTS messages_message_id ON messages (message_id);
CREATE INDEX IF NOT EXISTS proposals_thread ON proposals (thread_id, status);
CREATE INDEX IF NOT EXISTS spend_at ON spend (at);
`;

/** ~/.gradcode, or GRADCODE_HOME. Tests and /verify point it at a temp dir. */
export const homeDir = (env: Record<string, string | undefined> = process.env) =>
  env.GRADCODE_HOME ?? NodePath.join(NodeOS.homedir(), ".gradcode");

/** Opens (and creates) the one SQLite file that holds everything. `:memory:` for tests. */
export function openDb(file = NodePath.join(homeDir(), "gradcode.sqlite")) {
  if (file !== ":memory:") NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export type Db = DatabaseSync;

export const now = () => new Date().toISOString();

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 12)}`;

/** Reads one JSON value from the key-value table, or `fallback` when it isn't there yet. */
export function getKv<T>(db: Db, key: string, parse: (value: unknown) => T, fallback: T): T {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  return row ? parse(JSON.parse(String(row.value))) : fallback;
}

export function setKv(db: Db, key: string, value: unknown) {
  db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}
