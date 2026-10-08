import {
  type Award,
  type Change,
  PROFESSOR_FIELDS,
  Professor,
  type ProfessorField,
  Proposal,
  type ScopeItem,
} from "@getmyprof/contracts";
import { type Db, newId, now } from "./db.ts";
import { sameSchool } from "./sources.ts";

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
    linkedin: "",
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
    .toSorted(byMoneyThenFit);
}

// Unchecked money (tier 0) sorts after tier 4.
const tierRank = (t: number) => (t === 0 ? 5 : t);

/** Clear money first (tier 1 above 4), then fit, then name: the order every list shows. */
export const byMoneyThenFit = (a: Professor, b: Professor) =>
  tierRank(a.moneyTier) - tierRank(b.moneyTier) || b.fit - a.fit || a.name.localeCompare(b.name);

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
  // A money tier of 1 or 2 is a claim about money: it needs the page that shows it.
  const tier = Number(input.fields.moneyTier ?? 0);
  if ((tier === 1 || tier === 2) && !input.sources.some((s) => /^https?:\/\//.test(s)))
    return { skipped: "a money tier of 1 or 2 needs the page that shows the money as a source" };
  // A value set from one page and now changed from another: both sources go to Review.
  const known = fieldSources(recordProposals(db, key));
  const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? u;
  const newHosts = new Set(input.sources.map(host));
  for (const c of changes) {
    const was = known[c.field];
    const wasHost = was?.sources.find((s) => /^https?:\/\//.test(s));
    if (c.from && wasHost && !newHosts.has(host(wasHost)))
      c.disagrees = `${host(wasHost)}, ${was?.at.slice(0, 10)}`;
  }
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
  return keys
    .flatMap((key) => {
      const mine = pending.filter((p) => p.recordKey === key);
      const first = mine[0];
      const base =
        getRecord(db, key) ?? (first ? blankProfessor(first.recordName, first.university) : null);
      if (!base) return [];
      return [mine.reduce((acc, p) => applyChanges(acc, p.changes), base)];
    })
    .toSorted(byMoneyThenFit);
}

/** Every proposal ever made about one professor, in any thread. */
export const recordProposals = (db: Db, key: string) =>
  db
    .prepare("SELECT body FROM proposals WHERE record_key = ?")
    .all(key)
    .map((r) => Proposal.parse(JSON.parse(String(r.body))));

/** Each field's current value: the sources and date of the latest accepted change to it. */
export function fieldSources(proposals: Proposal[]) {
  const out: Record<string, { sources: string[]; at: string }> = {};
  const accepted = proposals
    .filter((p) => p.status === "accepted")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const p of accepted)
    for (const c of p.changes) out[c.field] = { sources: p.sources, at: p.createdAt };
  return out;
}

/** One professor as the agent reads it: what the sheet knows, on one line. */
export const recordLine = (r: Professor) =>
  [
    `- ${r.name}`,
    r.department ? `${r.university}, ${r.department}` : r.university,
    `key ${r.key}`,
    `fit ${r.fit}`,
    `money tier ${r.moneyTier || "?"}: ${r.money || "?"}`,
    `lasts ${r.lasts || "?"}`,
    `taking ${r.taking || "?"}`,
    `email ${r.email || "?"} (${r.emailCheck || "unchecked"})`,
    `contact ${r.contact || "?"}`,
    `stage ${r.stage}`,
    `site ${r.website || "?"}`,
    `linkedin ${r.linkedin || "?"}`,
    ...(r.niche ? [`niche ${r.niche}`] : []),
    ...(r.sources.length ? [`sources ${r.sources.join(" ")}`] : []),
  ].join(" | ");

/**
 * What the sheet knows about professors and schools a thread just took on: each professor's
 * record, each school's professors. The agent reads this instead of fetching the same pages.
 */
export function scopeNote(db: Db, items: ScopeItem[]) {
  if (!items.length) return "";
  const records = listRecords(db);
  const lines = items.flatMap((x) => {
    if (x.kind === "professor") {
      const r = getRecord(db, x.key);
      return [r ? recordLine(r) : `- ${x.name}: not in the sheet yet`];
    }
    const at = records.filter((r) => sameSchool(r.university, x.name));
    return at.length
      ? [`${x.name}, ${at.length} in the sheet:`, ...at.slice(0, 30).map(recordLine)]
      : [`- ${x.name}: nobody in the sheet yet`];
  });
  // ponytail: a fixed cap keeps a 24-school loop's note readable; search the sheet for the rest.
  const shown =
    lines.length > 80
      ? [...lines.slice(0, 80), `(${lines.length - 80} more lines: use sheet_search)`]
      : lines;
  return `Scope: ${items.map((x) => x.name).join(", ")}. What the sheet already has, with its sources; use it instead of fetching again, and fetch only what's missing or asked:\n${shown.join("\n")}`;
}

/** "LYBARGER, KEVIN" and "Kevin Lybarger" are the same person. */
export const personKey = (name: string) => {
  const parts = name.includes(",") ? name.split(",").toReversed().join(" ") : name;
  const w = parts.toLowerCase().split(/\s+/).filter(Boolean);
  return `${w[0]?.[0] ?? ""} ${w.at(-1) ?? ""}`;
};

/**
 * The sheet row for an award's PI, from one click in Funding: the award becomes their grant and
 * its page their source. A PI already in the sheet just gains the grant.
 */
export function professorFromAward(existing: Professor | null, a: Award): Professor {
  const grant = {
    source: a.source,
    id: a.id,
    title: a.title,
    usd: a.currency === "USD" ? a.amount : null,
    ends: a.ends,
  };
  const base = existing ?? {
    ...blankProfessor(a.pi, a.university),
    moneyTier: (a.monthsAfterIntake ?? 0) > 0 ? 2 : 3,
    money: `${a.source} award as PI${a.amount ? `, ${a.currency} ${Math.round(a.amount).toLocaleString("en-US")}` : ""}`,
    lasts: a.ends ?? "",
  };
  return {
    ...base,
    grants: base.grants.some((g) => g.id === a.id) ? base.grants : [...base.grants, grant],
    sources: base.sources.includes(a.url) ? base.sources : [...base.sources, a.url],
    updatedAt: now(),
  };
}
