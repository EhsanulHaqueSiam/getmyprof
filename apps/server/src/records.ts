import {
  type Change,
  PROFESSOR_FIELDS,
  Professor,
  type ProfessorField,
  Proposal,
} from "@gradcode/contracts";
import { type Db, newId, now } from "./db.ts";

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** One key per person per school, so the same professor found twice is one row. */
export const recordKey = (name: string, university: string) => `${slug(name)}@${slug(university)}`;

export function blankProfessor(name: string, university: string): Professor {
  return {
    key: recordKey(name, university),
    name,
    university,
    department: "",
    niche: "",
    fit: 0,
    moneyTier: 0,
    eligibility: "",
    taking: "",
    money: "",
    lasts: "",
    email: "",
    emailCheck: "",
    contact: "",
    stage: "new",
    fitsBecause: "",
    website: "",
    sources: [],
    grants: [],
    origin: "app",
    updatedAt: now(),
  };
}

const fieldValue = (p: Professor, f: ProfessorField) => String(p[f]);

/** Applies changes to a record, coercing each value to its field's type. */
export function applyChanges(p: Professor, changes: Change[]): Professor {
  const next: Record<string, unknown> = { ...p };
  for (const c of changes)
    next[c.field] = c.field === "fit" || c.field === "moneyTier" ? Number(c.to) : c.to;
  return Professor.parse({ ...next, updatedAt: now() });
}

export function getRecord(db: Db, key: string) {
  const row = db.prepare("SELECT body FROM records WHERE key = ?").get(key);
  return row ? Professor.parse(JSON.parse(String(row.body))) : null;
}

export function listRecords(db: Db) {
  return db
    .prepare("SELECT body FROM records")
    .all()
    .map((r) => Professor.parse(JSON.parse(String(r.body))))
    .toSorted((a, b) => b.fit - a.fit || a.name.localeCompare(b.name));
}

export function putRecord(db: Db, p: Professor) {
  db.prepare(
    "INSERT INTO records (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body",
  ).run(p.key, JSON.stringify(p));
}

export const exclusionFor = (db: Db, key: string) => {
  const row = db.prepare("SELECT reason FROM exclusions WHERE record_key = ?").get(key);
  return row ? String(row.reason) : null;
};

type Fields = { [F in ProfessorField]?: string | number | undefined };

/**
 * Turns what the agent found into a pending proposal: an `add` for someone new, an `update`
 * holding only the fields that differ. Returns null when nothing changed, or the reason when
 * the person was rejected before (a rejected row never comes back).
 */
export function propose(
  db: Db,
  threadId: string,
  input: { name: string; university: string; fields: Fields; sources: string[] },
): { proposal: Proposal } | { skipped: string } {
  const key = recordKey(input.name, input.university);
  const excluded = exclusionFor(db, key);
  if (excluded) return { skipped: `excluded earlier: ${excluded}` };
  const current = getRecord(db, key) ?? pendingAdd(db, key);
  const changes: Change[] = [];
  for (const field of PROFESSOR_FIELDS) {
    const raw =
      field === "name"
        ? input.name
        : field === "university"
          ? input.university
          : input.fields[field];
    if (raw === undefined) continue;
    const to = String(raw).trim();
    const from = current ? fieldValue(current, field) : null;
    const unknown = /^(\?|unchecked|not found|not stated|unknown)$/i;
    // An "unknown" from the agent never overwrites something already known.
    if (from && from !== "" && !unknown.test(from) && unknown.test(to)) continue;
    if (to !== "" && to !== from) changes.push({ field, from, to });
  }
  if (current && changes.length === 0) return { skipped: "no change" };
  const proposal: Proposal = {
    id: newId("prop"),
    threadId,
    recordKey: key,
    recordName: input.name,
    university: input.university,
    kind: current ? "update" : "add",
    changes,
    sources: input.sources,
    status: "pending",
    createdAt: now(),
  };
  db.prepare(
    "INSERT INTO proposals (id, thread_id, record_key, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(proposal.id, threadId, key, "pending", JSON.stringify(proposal), proposal.createdAt);
  db.prepare("INSERT OR IGNORE INTO thread_rows (thread_id, record_key) VALUES (?, ?)").run(
    threadId,
    key,
  );
  return { proposal };
}

/** A professor proposed but not yet accepted, as the row the grid should show. */
function pendingAdd(db: Db, key: string): Professor | null {
  const row = db
    .prepare(
      "SELECT body FROM proposals WHERE record_key = ? AND status = 'pending' AND body LIKE '%\"kind\":\"add\"%' LIMIT 1",
    )
    .get(key);
  if (!row) return null;
  const p = Proposal.parse(JSON.parse(String(row.body)));
  return applyChanges(blankProfessor(p.recordName, p.university), p.changes);
}

const parseProposal = (r: Record<string, unknown>) => Proposal.parse(JSON.parse(String(r.body)));

export function getProposal(db: Db, id: string) {
  const row = db.prepare("SELECT body FROM proposals WHERE id = ?").get(id);
  return row ? parseProposal(row) : null;
}

export const threadProposals = (db: Db, threadId: string) =>
  db
    .prepare("SELECT body FROM proposals WHERE thread_id = ? ORDER BY created_at")
    .all(threadId)
    .map(parseProposal);

export const pendingCount = (db: Db, threadId: string) =>
  Number(
    db
      .prepare("SELECT COUNT(*) AS n FROM proposals WHERE thread_id = ? AND status = 'pending'")
      .get(threadId)?.n ?? 0,
  );

/**
 * Accept writes the change into the record. Reject marks it, and rejecting an `add` excludes
 * the person so later sweeps skip them. Returns the records that changed.
 */
export function resolveProposal(db: Db, id: string, decision: "accept" | "reject") {
  const p = getProposal(db, id);
  if (!p || p.status !== "pending") return null;
  const status = decision === "accept" ? "accepted" : "rejected";
  db.prepare("UPDATE proposals SET status = ?, body = ? WHERE id = ?").run(
    status,
    JSON.stringify({ ...p, status }),
    id,
  );
  if (decision === "reject") {
    if (p.kind === "add")
      db.prepare("INSERT OR REPLACE INTO exclusions (record_key, reason, at) VALUES (?, ?, ?)").run(
        p.recordKey,
        "rejected in Review",
        now(),
      );
    return { proposal: { ...p, status }, record: null };
  }
  const base = getRecord(db, p.recordKey) ?? blankProfessor(p.recordName, p.university);
  const record = applyChanges(
    { ...base, sources: [...new Set([...base.sources, ...p.sources])] },
    p.changes,
  );
  putRecord(db, record);
  return { proposal: { ...p, status }, record };
}

/** The rows a thread found: its records with pending changes layered on top. */
export function threadRows(db: Db, threadId: string): Professor[] {
  const keys = db
    .prepare("SELECT record_key FROM thread_rows WHERE thread_id = ?")
    .all(threadId)
    .map((r) => String(r.record_key));
  const pending = threadProposals(db, threadId).filter((p) => p.status === "pending");
  return keys.flatMap((key) => {
    const mine = pending.filter((p) => p.recordKey === key);
    const first = mine[0];
    const base =
      getRecord(db, key) ?? (first ? blankProfessor(first.recordName, first.university) : null);
    if (!base) return [];
    return [mine.reduce((acc, p) => applyChanges(acc, p.changes), base)];
  });
}
