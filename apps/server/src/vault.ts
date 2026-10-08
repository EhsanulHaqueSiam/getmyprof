// The vault's store: one table of typed items (documents, scholarships, programs, applications,
// the school shortlist, and the agent's finds waiting in To file), plus document bytes under
// GETMYPROF_HOME/files.
import {
  Application,
  factStatus,
  FileItem,
  type ProfileFact,
  Program,
  Scholarship,
  School,
  VaultDocument,
  type VaultEdit,
  type VaultKind,
  type VaultState,
  Offer,
  Writing,
  type WritingKind,
} from "@getmyprof/contracts";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { z } from "zod";
import { type Db, getKv, homeDir, newId, now, setKv } from "./db.ts";
import { getRecord, listRecords } from "./records.ts";

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
export const listWriting = (db: Db) => items(db, "writing", Writing);
export const listOffers = (db: Db) => items(db, "offer", Offer);
export const listSchools = (db: Db) => items(db, "school", School);

/** The offer the applicant accepted, if any: the hunt is over, so loops and cold mail stop. */
export const acceptedOffer = (db: Db) =>
  listOffers(db).find((o) => o.status === "accepted") ?? null;

export function vaultState(db: Db): VaultState {
  return {
    documents: listDocuments(db),
    scholarships: items(db, "scholarship", Scholarship),
    programs: listPrograms(db),
    applications: listApplications(db),
    offers: listOffers(db),
    writing: listWriting(db),
    toFile: items(db, "toFile", FileItem),
    schools: listSchools(db),
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
  const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
  const same = listDocuments(db).find((d) => d.sha256 === sha256);
  if (same) return same;
  const doc: VaultDocument = {
    id: newId("doc"),
    name: input.name,
    kind: input.kind,
    mime: input.mime || "application/octet-stream",
    size: bytes.length,
    expires: input.expires,
    uploadedAt: now(),
    sha256,
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

/**
 * Puts a school the agent suggests on the shortlist, waiting for keep or drop. One still waiting
 * takes the newer details; a kept or dropped one stays as the applicant left it.
 */
export function proposeSchool(
  db: Db,
  s: Omit<School, "id" | "status">,
): School | { skipped: string } {
  const same = listSchools(db).find((x) => norm(x.name) === norm(s.name));
  if (same?.status === "dropped") return { skipped: "dropped earlier" };
  if (same?.status === "kept") return { skipped: `on the shortlist already, as ${same.tier}` };
  const school = School.parse({ ...s, id: same?.id ?? newId("school"), status: "suggested" });
  putItem(db, "school", school);
  return school;
}

/** Files a find into the vault, or drops it so it never comes back. Returns the find. */
export function resolveFinding(db: Db, id: string, decision: "file" | "dismiss") {
  const f = items(db, "toFile", FileItem).find((x) => x.id === id);
  if (!f) return null;
  removeItem(db, "toFile", id);
  if (decision === "dismiss") {
    const dismissed = getKv(db, "vault.dismissed", (v) => z.array(z.string()).parse(v), []);
    setKv(db, "vault.dismissed", [...dismissed, findingKey(f)]);
    return f;
  }
  if (f.kind === "scholarship")
    putItem(db, "scholarship", { ...f.item, id: newId("sch"), status: "watch", note: "" });
  else putItem(db, "program", { ...f.item, id: newId("prog"), note: "" });
  return f;
}

/** Whether a thread still has finds waiting in To file. */
export const findsWaiting = (db: Db, threadId: string) =>
  items(db, "toFile", FileItem).some((f) => f.threadId === threadId);

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
    applicationId: "",
    professors: listRecords(db)
      .filter((r) => norm(r.university) === school && ["sent", "replied"].includes(r.stage))
      .map((r) => r.key),
    submittedAt: null,
    note: "",
    interviews: [],
  };
  putItem(db, "application", app);
  return app;
}

const TOKEN = /\[\[([^\]\s]+)\]\]/g;

/** "my BSc [[fact_a]]" becomes "my BSc [1]" with citations {1: fact_a}. One fact keeps one number. */
export function numberCitations(text: string) {
  const ids: string[] = [];
  const body = text.replace(TOKEN, (_, id: string) => {
    if (!ids.includes(id)) ids.push(id);
    return `[${ids.indexOf(id) + 1}]`;
  });
  return { body, citations: Object.fromEntries(ids.map((id, i) => [String(i + 1), id])) };
}

/** The other way, so a revision starts from the agent's own citation tokens. */
const withTokens = (w: Writing) =>
  w.body.replace(/\[(\d+)\]/g, (m, n: string) => {
    const id = w.citations[n];
    return id ? `[[${id}]]` : m;
  });

/** Saves the agent's text as a new piece, or as the next draft of `pieceId`. */
export function saveWriting(
  db: Db,
  input: {
    pieceId: string | null;
    kind: WritingKind;
    title: string;
    programId: string | null;
    scholarshipId: string | null;
    text: string;
    threadId: string | null;
  },
) {
  const prior = input.pieceId ? listWriting(db).find((w) => w.id === input.pieceId) : undefined;
  const piece: Writing = {
    id: prior?.id ?? newId("wri"),
    kind: input.kind,
    title: input.title,
    programId: input.programId,
    scholarshipId: input.scholarshipId,
    draft: (prior?.draft ?? 0) + 1,
    ...numberCitations(input.text),
    threadId: input.threadId,
    updatedAt: now(),
    history: prior
      ? [
          ...prior.history,
          { draft: prior.draft, body: prior.body, citations: prior.citations, at: prior.updatedAt },
        ].slice(-10)
      : [],
  };
  putItem(db, "writing", piece);
  return piece;
}

const KIND_LABEL: Record<WritingKind, string> = {
  sop: "a statement of purpose",
  cv: "an academic CV",
  essay: "a scholarship essay",
  prep: "a private interview prep pack",
  letter: "a short, warm negotiation letter",
  note: "a short, warm email",
  visa: "a private plan of the visa steps",
};

const TITLE: Record<WritingKind, string> = {
  sop: "Statement of purpose",
  cv: "Academic CV",
  essay: "Scholarship essay",
  prep: "Interview prep",
  letter: "Negotiation",
  note: "Note",
  visa: "Visa steps",
};

/**
 * What a writing thread starts with: the target, the professors to name, every fact with its id
 * and status, and the earlier piece when tailoring. The first line is a tag the fake agent reads.
 */
export function writingBrief(
  db: Db,
  facts: ProfileFact[],
  input: {
    kind: WritingKind;
    programId: string | null;
    scholarshipId: string | null;
    basedOn: string | null;
    about?: string | null | undefined;
    offerId?: string | null | undefined;
  },
) {
  const v = vaultState(db);
  const offer = v.offers.find((o) => o.id === input.offerId);
  const title = [
    TITLE[input.kind],
    input.kind === "prep" || input.kind === "note" || input.kind === "visa"
      ? // A title is for scanning: no email addresses, no long tails.
        input.about
          ?.replace(/\s*\([^)]*@[^)]*\)/g, "")
          .split(":")[0]
          ?.slice(0, 60)
      : input.kind === "letter"
        ? offer?.university
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const program = v.programs.find((p) => p.id === input.programId);
  const scholarship = v.scholarships.find((s) => s.id === input.scholarshipId);
  // Writing for a target that already has a piece revises it, so one statement per program.
  const base =
    v.writing.find((w) => w.id === input.basedOn) ??
    v.writing.find(
      (w) =>
        w.kind === input.kind &&
        w.programId === input.programId &&
        w.scholarshipId === input.scholarshipId &&
        // Several prep packs or letters can share a program; they differ by who or what they're for.
        (["prep", "letter", "note", "visa"].includes(input.kind) ? w.title === title : true),
    );
  // Revising the same target keeps one piece with a new draft; another target gets its own piece.
  const revise =
    base && base.programId === input.programId && base.scholarshipId === input.scholarshipId
      ? base
      : undefined;
  const named = (v.applications.find((a) => a.programId === program?.id)?.professors ?? []).flatMap(
    (k) => getRecord(db, k)?.name ?? [],
  );
  const target = program
    ? `${program.university} · ${program.name}`
    : scholarship
      ? `${scholarship.name} (${scholarship.sponsor})`
      : "";
  const threadTitle = `${revise ? "Revise" : "Write"}: ${title}${target ? ` · ${program?.university ?? scholarship?.name}` : ""}`;
  const text = [
    `[write] kind=${input.kind} program=${program?.id ?? "-"} scholarship=${scholarship?.id ?? "-"} revise=${revise?.id ?? "-"}`,
    `Write ${KIND_LABEL[input.kind]}${target ? ` for ${target}` : ""} for the applicant, then save it with write_document (kind ${input.kind}, title "${title}", programId ${program?.id ?? "null"}, scholarshipId ${scholarship?.id ?? "null"}, pieceId ${revise?.id ?? "null"}).`,
    program
      ? `Read the program page (${program.url}) for what the statement must cover and its length limit.`
      : "",
    scholarship
      ? `Read the scholarship page (${scholarship.url}) for the essay prompt and its length limit.`
      : "",
    named.length && (input.kind === "sop" || input.kind === "essay")
      ? `Name these professors where they genuinely fit: ${named.join(", ")}.`
      : "",
    input.kind === "prep"
      ? `The interview is with ${input.about ?? "the program"}. Look up their recent papers with openalex_author and list two or three with one line on each, then the questions they are likely to ask, then talking points from the applicant's facts. It stays private: it is never sent.`
      : "",
    input.kind === "note"
      ? `It is this: ${input.about ?? ""}. Three to five sentences, plain text, ready to paste into an email.`
      : "",
    input.kind === "visa"
      ? `The applicant accepted ${input.about ?? "an offer"}. For their citizenship, write the steps from acceptance to arrival: which visa, the documents, proof of funds, fees, appointment waits and a timeline, each with an official source. It stays private.`
      : "",
    input.kind === "letter" && offer
      ? [
          `The offer: ${offer.program} at ${offer.university}: stipend ${offer.stipend ?? "?"} ${offer.currency} a ${offer.stipendPer}, tuition ${offer.tuition}, ${offer.years ?? "?"} years, duties "${offer.duties}", answer by ${offer.respondBy ?? "?"}.`,
          `Other offers: ${
            v.offers
              .filter((o) => o.id !== offer.id && o.status !== "declined")
              .map((o) => `${o.university} ${o.stipend ?? "?"} ${o.currency} a ${o.stipendPer}`)
              .join("; ") || "none"
          }.`,
          "Thank them, say what would make it work (a higher stipend, summer funding, a later answer date), and ask; mention another offer only if there is one.",
        ].join("\n")
      : "",
    "Right after every claim about the applicant, cite the fact it rests on as [[fact-id]] from this list. Write no claim that has no fact here; a fact marked anything but confirmed blocks export until it has proof.",
    ...facts.map((f) => `- [[${f.id}]] ${f.text} (${factStatus(f)})`),
    base
      ? `Start from this earlier piece ("${base.title}", draft ${base.draft}) and tailor it:\n"""\n${withTokens(base)}\n"""`
      : "",
    "Plain text, short paragraphs, no em dashes, no test score unless a fact gives it.",
  ]
    .filter(Boolean)
    .join("\n");
  return { title, threadTitle, text, threadId: revise?.threadId ?? null };
}

/** Vault documents as attachments for a message, read from disk; unknown ids are skipped. */
export function readAttachments(db: Db, ids: string[]) {
  const docs = listDocuments(db);
  return ids.flatMap((id) => {
    const d = docs.find((x) => x.id === id);
    if (!d || !NodeFS.existsSync(documentPath(d.id))) return [];
    return [
      {
        name: d.name,
        mime: d.mime,
        base64: NodeFS.readFileSync(documentPath(d.id)).toString("base64"),
      },
    ];
  });
}
