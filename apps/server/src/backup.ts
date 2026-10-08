// Everything you have, in one file: every table plus the Vault's files. Export, wipe, import and
// nothing is lost. The mailbox login is not in it (it lives in mail.json, not the store), so a
// restored install reconnects its mailbox once.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { z } from "zod";
import { type Db, now } from "./db.ts";
import { documentPath } from "./vault.ts";

const TABLES = [
  "kv",
  "threads",
  "events",
  "thread_rows",
  "records",
  "proposals",
  "exclusions",
  "loops",
  "spend",
  "messages",
  "vault",
] as const;

const Row = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
export const Backup = z.object({
  // gradcode was this app's name until 2026-10-08; its backups restore as they are.
  app: z.enum(["getmyprof", "gradcode"]),
  version: z.literal(1),
  at: z.string(),
  tables: z.record(z.string(), z.array(Row)),
  /** Vault document bytes by document id, base64. */
  files: z.record(z.string(), z.string()),
});
export type Backup = z.infer<typeof Backup>;

const DOC_ID = /^doc_[\w-]+$/;

export function exportAll(db: Db): Backup {
  const tables = Object.fromEntries(
    TABLES.map((t) => [
      t,
      db
        .prepare(`SELECT * FROM ${t}`)
        .all()
        .map((r) => Row.parse({ ...r })),
    ]),
  );
  const files: Record<string, string> = {};
  for (const r of tables.vault ?? []) {
    const id = String(r.id);
    if (r.kind === "document" && DOC_ID.test(id) && NodeFS.existsSync(documentPath(id)))
      files[id] = NodeFS.readFileSync(documentPath(id)).toString("base64");
  }
  return { app: "getmyprof", version: 1, at: now(), tables, files };
}

/** Restores a backup over this store: rows by primary key, files by id. Returns rows per table. */
export function importAll(db: Db, raw: unknown) {
  const backup = Backup.parse(raw);
  const counts: Record<string, number> = {};
  db.exec("BEGIN");
  try {
    for (const t of TABLES) {
      const rows = backup.tables[t] ?? [];
      // Only the table's real columns, so nothing from the file reaches the SQL text.
      const columns = new Set(
        db
          .prepare(`PRAGMA table_info(${t})`)
          .all()
          .map((c) => String(c.name)),
      );
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => columns.has(k));
        if (keys.length === 0) continue;
        db.prepare(
          `INSERT OR REPLACE INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        ).run(...keys.map((k) => row[k] ?? null));
      }
      counts[t] = rows.length;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const [id, base64] of Object.entries(backup.files)) {
    if (!DOC_ID.test(id)) continue;
    NodeFS.mkdirSync(NodePath.dirname(documentPath(id)), { recursive: true });
    NodeFS.writeFileSync(documentPath(id), Buffer.from(base64, "base64"), { mode: 0o600 });
  }
  return counts;
}
