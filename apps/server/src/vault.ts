// The vault's store: one table of typed items (documents, scholarships, programs, applications,
// and the agent's finds waiting in To file), plus document bytes under GRADCODE_HOME/files.
import {
  Application,
  FileItem,
  Program,
  Scholarship,
  VaultDocument,
  type VaultEdit,
  type VaultKind,
  type VaultState,
} from "@gradcode/contracts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { z } from "zod";
import { type Db, getKv, homeDir, newId, now, setKv } from "./db.ts";
import { listRecords } from "./records.ts";

type Kind = VaultKind | "toFile";

function items<S extends z.ZodType>(db: Db, kind: Kind, schema: S): z.output<S>[] {
  return db
    .prepare("SELECT body FROM vault WHERE kind = ? ORDER BY created_at")
    .all(kind)
    .map((r) => schema.parse(JSON.parse(String(r.body))));
}

function putItem<T extends { id: string }>(db: Db, kind: Kind, item: T) {
  db.prepare(
    `INSERT INTO vault (id, kind, body, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
  ).run(item.id, kind, JSON.stringify(item), now());
}

const removeItem = (db: Db, kind: Kind, id: string) =>
  db.prepare("DELETE FROM vault WHERE kind = ? AND id = ?").run(kind, id);

export const listDocuments = (db: Db) => items(db, "document", VaultDocument);
export const listPrograms = (db: Db) => items(db, "program", Program);
export const listApplications = (db: Db) => items(db, "application", Application);

export function vaultState(db: Db): VaultState {
  return {
    documents: listDocuments(db),
    scholarships: items(db, "scholarship", Scholarship),
    programs: listPrograms(db),
    applications: listApplications(db),
    toFile: items(db, "toFile", FileItem),
  };
}

/** Saves one edited item. Returns the application before the edit, so callers see transitions. */
export function saveEdit(db: Db, edit: VaultEdit) {
  const before =
    edit.kind === "application"
      ? (listApplications(db).find((a) => a.id === edit.value.id) ?? null)
      : null;
  putItem(db, edit.kind, edit.value);
  return before;
}

const filesDir = () => NodePath.join(homeDir(), "files");
/** A document's bytes on disk. Named by id only, so no user text ever reaches a path. */
export const documentPath = (id: string) => NodePath.join(filesDir(), id);

export function saveDocument(
  db: Db,
  input: Pick<VaultDocument, "name" | "kind" | "mime" | "expires"> & { base64: string },
) {
  const bytes = Buffer.from(input.base64, "base64");
  const doc: VaultDocument = {
    id: newId("doc"),
    name: input.name,
    kind: input.kind,
    mime: input.mime || "application/octet-stream",
    size: bytes.length,
    expires: input.expires,
    uploadedAt: now(),
  };
  NodeFS.mkdirSync(filesDir(), { recursive: true });
  NodeFS.writeFileSync(documentPath(doc.id), bytes, { mode: 0o600 });
  putItem(db, "document", doc);
  return doc;
}

export function removeEntry(db: Db, kind: VaultKind, id: string) {
  removeItem(db, kind, id);
  if (kind === "document") NodeFS.rmSync(documentPath(id), { force: true });
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** A find without the fields the store assigns. Distributes, so `kind` still narrows `item`. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewFinding = DistributiveOmit<FileItem, "id" | "createdAt">;
type Keyed =
  | { kind: "scholarship"; item: Pick<Scholarship, "name" | "sponsor"> }
  | { kind: "program"; item: Pick<Program, "university" | "name"> };

const findingKey = (f: Keyed) =>
  f.kind === "scholarship"
    ? `scholarship:${norm(f.item.name)}|${norm(f.item.sponsor)}`
    : `program:${norm(f.item.university)}|${norm(f.item.name)}`;

/**
 * Puts something the agent found into To file. Skips it when the vault already holds it, it's
 * already waiting, or the user dismissed it before.
 */
export function proposeFinding(db: Db, f: NewFinding): FileItem | { skipped: string } {
  const key = findingKey(f);
  const dismissed = getKv(db, "vault.dismissed", (v) => z.array(z.string()).parse(v), []);
  if (dismissed.includes(key)) return { skipped: "dismissed earlier" };
  const s = vaultState(db);
  const held = [
    ...s.toFile.map(findingKey),
    ...s.scholarships.map((item) => findingKey({ kind: "scholarship", item })),
    ...s.programs.map((item) => findingKey({ kind: "program", item })),
  ];
  if (held.includes(key)) return { skipped: "already in the vault" };
  const finding = FileItem.parse({ ...f, id: newId("find"), createdAt: now() });
  putItem(db, "toFile", finding);
  return finding;
}

/** Files a find into the vault, or drops it so it never comes back. */
export function resolveFinding(db: Db, id: string, decision: "file" | "dismiss") {
  const f = items(db, "toFile", FileItem).find((x) => x.id === id);
  if (!f) return;
  removeItem(db, "toFile", id);
  if (decision === "dismiss") {
    const dismissed = getKv(db, "vault.dismissed", (v) => z.array(z.string()).parse(v), []);
    setKv(db, "vault.dismissed", [...dismissed, findingKey(f)]);
    return;
  }
  if (f.kind === "scholarship")
    putItem(db, "scholarship", { ...f.item, id: newId("sch"), status: "watch", note: "" });
  else putItem(db, "program", { ...f.item, id: newId("prog"), note: "" });
}

const CHECKLIST = [
  ["CV", "cv"],
  ["Transcript", "transcript"],
  ["Statement of purpose", null],
  ["English test or MOI certificate", "test"],
  ["Passport", "passport"],
] as const;

/**
 * Starts an application with the usual checklist, linked to documents already in the vault,
 * and names the professors already contacted at that school.
 */
export function startApplication(db: Db, programId: string): Application {
  const program = listPrograms(db).find((p) => p.id === programId);
  if (!program) throw new Error("No such program");
  const existing = listApplications(db).find((a) => a.programId === programId);
  if (existing) return existing;
  const docs = listDocuments(db);
  const school = norm(program.university);
  const app: Application = {
    id: newId("app"),
    programId,
    status: "planning",
    waiver: "none",
    documents: CHECKLIST.map(([name, kind]) => {
      const doc = kind ? docs.find((d) => d.kind === kind) : undefined;
      return { name, docId: doc?.id ?? null, done: !!doc };
    }),
    recommenders: [],
    portal: program.url,
    portalStatus: "",
    professors: listRecords(db)
      .filter((r) => norm(r.university) === school && ["sent", "replied"].includes(r.stage))
      .map((r) => r.key),
    submittedAt: null,
    note: "",
  };
  putItem(db, "application", app);
  return app;
}
