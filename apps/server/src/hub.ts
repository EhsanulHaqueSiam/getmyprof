// The hub side: this install as a counselor's, which students connect to with an invite code.
// Students POST their progress report and, if they choose, public facts; the hub serves the
// shared catalog back. bin.ts hands /api/hub/* to serveHub; hubRequest is the logic, for tests.
import {
  CatalogFact,
  type HubCatalog,
  HubFacts,
  HubInvite,
  HubStudent,
  ProgressReport,
} from "@getmyprof/contracts";
import * as NodeCrypto from "node:crypto";
import type * as NodeHttp from "node:http";
import { z } from "zod";
import { type Db, newId, now } from "./db.ts";
import { sameToken } from "./mcp.ts";
import { listRecords, recordKey } from "./records.ts";
import { findingKey, vaultState } from "./vault.ts";

/** Request bodies past this many bytes get a 413. */
export const HUB_LIMIT = 1_000_000;

const sha256 = (s: string) => NodeCrypto.createHash("sha256").update(s).digest("hex");
const isUrl = (s: string) => /^https?:\/\//.test(s);

/**
 * A new student and their invite code: base64url JSON of this hub's URL, their token and name.
 * Only the token's hash is kept, so the code shows once.
 */
export function inviteStudent(db: Db, name: string, url: string) {
  const u = url.trim().replace(/\/+$/, "");
  if (!HubInvite.shape.u.safeParse(u).success)
    throw new Error("Give the address students reach this hub at, like https://name.ts.net:8443.");
  const token = NodeCrypto.randomBytes(24).toString("base64url");
  const invite: HubInvite = { u, t: token, n: name.trim() };
  db.prepare("INSERT INTO students (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)").run(
    newId("stu"),
    invite.n,
    sha256(token),
    now(),
  );
  return { code: Buffer.from(JSON.stringify(invite)).toString("base64url") };
}

/** The invite inside a pasted code, or a plain error for anything else. */
export function readInvite(code: string) {
  try {
    return HubInvite.parse(JSON.parse(Buffer.from(code.trim(), "base64url").toString("utf8")));
  } catch {
    throw new Error("That isn't an invite code. Paste the whole code from your counselor.");
  }
}

export const listStudents = (db: Db) =>
  db
    .prepare("SELECT * FROM students ORDER BY name")
    .all()
    .map((r) =>
      HubStudent.parse({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        syncedAt: r.synced_at,
        report: r.report ? JSON.parse(String(r.report)) : null,
      }),
    );

export const studentCount = (db: Db) =>
  Number(db.prepare("SELECT COUNT(*) AS n FROM students").get()?.n ?? 0);

export const removeStudent = (db: Db, id: string) =>
  db.prepare("DELETE FROM students WHERE id = ?").run(id);

/** The student a bearer token belongs to, or null. */
function studentFor(db: Db, authorization: string | undefined) {
  const token = /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .prepare("SELECT id, token_hash FROM students")
    .all()
    .find((r) => sameToken(hash, String(r.token_hash)));
  return row ? String(row.id) : null;
}

/**
 * What this install can share: Vault programs and scholarships, and the sheet's public details
 * with their pages. Never profile facts, drafts, messages, fit, stage, eligibility or notes:
 * parsing through CatalogFact drops every field it doesn't name.
 */
export function publicFacts(db: Db): CatalogFact[] {
  const filed = new Map(
    db
      .prepare("SELECT id, created_at FROM vault WHERE kind IN ('program', 'scholarship')")
      .all()
      .map((r) => [String(r.id), String(r.created_at)]),
  );
  const v = vaultState(db);
  const fact = (kind: CatalogFact["kind"], checkedAt: string, item: { sources: string[] }) =>
    CatalogFact.parse({ kind, checkedAt, item: { ...item, sources: item.sources.filter(isUrl) } });
  return [
    ...v.programs.map((p) => fact("program", filed.get(p.id) ?? now(), p)),
    ...v.scholarships.map((s) => fact("scholarship", filed.get(s.id) ?? now(), s)),
    ...listRecords(db)
      .filter((r) => [r.email, r.website, r.scholar, r.recent, r.taking].some(Boolean))
      .map((r) => fact("professor", r.updatedAt, r)),
  ];
}

/** One key per fact: a program by university and name, a scholarship by name and sponsor. */
export const catalogKey = (f: CatalogFact) =>
  f.kind === "professor" ? `professor:${recordKey(f.item.name, f.item.university)}` : findingKey(f);

type Held = { fact: CatalogFact; contributors: string[] };

/** A fact into what the catalog holds under its key: the newer check wins, contributors add up. */
export const mergeFact = (held: Held | undefined, fact: CatalogFact, by: string): Held => ({
  fact: held && held.fact.checkedAt >= fact.checkedAt ? held.fact : fact,
  contributors: [...new Set([...(held?.contributors ?? []), by])],
});

function catalogRows(db: Db) {
  return new Map(
    db
      .prepare("SELECT key, body, contributors FROM catalog")
      .all()
      .map((r) => [
        String(r.key),
        {
          fact: CatalogFact.parse(JSON.parse(String(r.body))),
          contributors: z.array(z.string()).parse(JSON.parse(String(r.contributors))),
        },
      ]),
  );
}

/** Merges facts a student gave back, as from `by` (a student id). */
export function addFacts(db: Db, facts: CatalogFact[], by: string) {
  const held = catalogRows(db);
  const put = db.prepare(
    `INSERT INTO catalog (key, kind, body, contributors, checked_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET body = excluded.body, contributors = excluded.contributors,
       checked_at = excluded.checked_at`,
  );
  db.exec("BEGIN");
  try {
    for (const f of facts) {
      const key = catalogKey(f);
      const next = mergeFact(held.get(key), f, by);
      held.set(key, next);
      put.run(
        key,
        f.kind,
        JSON.stringify(next.fact),
        JSON.stringify(next.contributors),
        next.fact.checkedAt,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The catalog students pull: what they gave back, plus this install's own facts as "hub". */
export function servedCatalog(db: Db): HubCatalog {
  const held = catalogRows(db);
  for (const f of publicFacts(db)) {
    const key = catalogKey(f);
    held.set(key, mergeFact(held.get(key), f, "hub"));
  }
  return { facts: [...held.values()].map((h) => ({ fact: h.fact, by: h.contributors.length })) };
}

const ROUTES = new Set(["POST /api/hub/report", "GET /api/hub/catalog", "POST /api/hub/facts"]);

/**
 * One request to /api/hub/*, answered as a status and JSON: 401 without a student's token, 413
 * when `body` is null (it ran past HUB_LIMIT), 400 when it doesn't parse.
 */
export function hubRequest(
  db: Db,
  req: { method: string; path: string; authorization: string | undefined; body: string | null },
): { status: number; json: unknown } {
  const route = `${req.method} ${req.path.split("?")[0]}`;
  if (!ROUTES.has(route)) return { status: 404, json: { error: "not found" } };
  const id = studentFor(db, req.authorization);
  if (!id) return { status: 401, json: { error: "unauthorized" } };
  if (req.body === null) return { status: 413, json: { error: "too large" } };
  if (route === "GET /api/hub/catalog") return { status: 200, json: servedCatalog(db) };
  let raw: unknown;
  try {
    raw = JSON.parse(req.body);
  } catch {
    return { status: 400, json: { error: "not JSON" } };
  }
  if (route === "POST /api/hub/report") {
    const report = ProgressReport.safeParse(raw);
    if (!report.success) return { status: 400, json: { error: "not a progress report" } };
    db.prepare("UPDATE students SET report = ?, synced_at = ? WHERE id = ?").run(
      JSON.stringify(report.data),
      now(),
      id,
    );
    return { status: 200, json: { ok: true } };
  }
  const given = HubFacts.safeParse(raw);
  if (!given.success) return { status: 400, json: { error: "not catalog facts" } };
  addFacts(db, given.data.facts, id);
  return { status: 200, json: { ok: true } };
}

/** A request body as text, or null once it passes `limit` bytes. */
function readCapped(req: NodeHttp.IncomingMessage, limit: number) {
  return new Promise<string | null>((resolve) => {
    if (Number(req.headers["content-length"] ?? 0) > limit) {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else {
        resolve(null);
        req.pause();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/** bin.ts's door for /api/hub/*. `onChange` runs after a student's report or facts land. */
export function serveHub(
  db: Db,
  req: NodeHttp.IncomingMessage,
  res: NodeHttp.ServerResponse,
  onChange: () => void,
) {
  void readCapped(req, HUB_LIMIT).then((body) => {
    const r = hubRequest(db, {
      method: req.method ?? "",
      path: req.url ?? "",
      authorization: req.headers.authorization,
      body,
    });
    if (r.status === 200 && req.method === "POST") onChange();
    res
      .writeHead(r.status, {
        "content-type": "application/json",
        ...(body === null ? { connection: "close" } : {}),
      })
      .end(JSON.stringify(r.json));
  });
}
