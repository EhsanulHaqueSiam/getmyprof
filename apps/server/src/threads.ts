import { ThreadEvent, type ThreadStatus, type ThreadSummary } from "@gradcode/contracts";
import { type Db, newId, now } from "./db.ts";
import { pendingCount } from "./records.ts";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

function summarize(db: Db, r: Row): ThreadSummary {
  const id = String(r.id);
  return {
    id,
    title: String(r.title),
    status: String(r.status) as ThreadStatus,
    unread: Number(r.unread) === 1,
    settledAt: str(r.settled_at),
    snoozedUntil: str(r.snoozed_until),
    workingSince: str(r.working_since),
    updatedAt: String(r.updated_at),
    spendUsd: threadSpend(db, id),
    loopId: str(r.loop_id),
    pendingReview: pendingCount(db, id),
    rows: Number(
      db.prepare("SELECT COUNT(*) AS n FROM thread_rows WHERE thread_id = ?").get(id)?.n ?? 0,
    ),
  };
}

export function createThread(db: Db, title: string, loopId: string | null = null) {
  const id = newId("thr");
  const at = now();
  db.prepare(
    "INSERT INTO threads (id, title, status, created_at, updated_at, loop_id) VALUES (?, ?, 'idle', ?, ?, ?)",
  ).run(id, title, at, at, loopId);
  return getThread(db, id)!;
}

export function getThread(db: Db, id: string) {
  const r = db.prepare("SELECT * FROM threads WHERE id = ?").get(id);
  return r ? summarize(db, r) : null;
}

export const listThreads = (db: Db) =>
  db
    .prepare("SELECT * FROM threads ORDER BY updated_at DESC")
    .all()
    .map((r) => summarize(db, r));

export const sessionId = (db: Db, id: string) =>
  str(db.prepare("SELECT session_id FROM threads WHERE id = ?").get(id)?.session_id);

export function setSession(db: Db, id: string, session: string) {
  db.prepare("UPDATE threads SET session_id = ? WHERE id = ?").run(session, id);
}

export function setStatus(db: Db, id: string, status: ThreadStatus) {
  const working = status === "working" || status === "approval";
  db.prepare(
    `UPDATE threads SET status = ?, updated_at = ?,
       working_since = CASE WHEN ? THEN COALESCE(working_since, ?) ELSE NULL END
     WHERE id = ?`,
  ).run(status, now(), working ? 1 : 0, now(), id);
}

export const markUnread = (db: Db, id: string, unread: boolean) =>
  db.prepare("UPDATE threads SET unread = ? WHERE id = ?").run(unread ? 1 : 0, id);

export function settle(db: Db, id: string, settled: boolean) {
  db.prepare(
    "UPDATE threads SET settled_at = ?, snoozed_until = NULL, unread = 0 WHERE id = ?",
  ).run(settled ? now() : null, id);
}

export const snooze = (db: Db, id: string, until: string | null) =>
  db.prepare("UPDATE threads SET snoozed_until = ?, settled_at = NULL WHERE id = ?").run(until, id);

export const rename = (db: Db, id: string, title: string) =>
  db.prepare("UPDATE threads SET title = ? WHERE id = ?").run(title, id);

/** Settle a thread once nothing waits on the user: idle, no pending review. Returns whether it settled. */
export function settleIfDone(db: Db, id: string) {
  const t = getThread(db, id);
  if (!t || t.settledAt || t.status !== "idle" || t.pendingReview > 0) return false;
  settle(db, id, true);
  return true;
}

/** Auto-settle threads nobody touched for `days`. */
export function settleStale(db: Db, days = 3) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  return db
    .prepare(
      "UPDATE threads SET settled_at = ? WHERE settled_at IS NULL AND status = 'idle' AND updated_at < ?",
    )
    .run(now(), cutoff).changes;
}

/** Appends an event, or replaces the one with the same id while keeping its place. */
export function putEvent(db: Db, threadId: string, event: ThreadEvent) {
  const seq = Number(
    db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM events WHERE thread_id = ?")
      .get(threadId)?.s ?? 1,
  );
  db.prepare(
    "INSERT INTO events (thread_id, id, seq, body) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id, id) DO UPDATE SET body = excluded.body",
  ).run(threadId, event.id, seq, JSON.stringify(event));
  db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(now(), threadId);
}

/** The question a thread is waiting on, if any. */
export const pendingQuestion = (db: Db, threadId: string) =>
  listEvents(db, threadId).findLast((e) => e.type === "question" && e.status === "pending") ?? null;

export const listEvents = (db: Db, threadId: string) =>
  db
    .prepare("SELECT body FROM events WHERE thread_id = ? ORDER BY seq")
    .all(threadId)
    .map((r) => ThreadEvent.parse(JSON.parse(String(r.body))));

export function recordSpend(db: Db, threadId: string | null, what: string, usd: number) {
  db.prepare("INSERT INTO spend (thread_id, what, usd, at) VALUES (?, ?, ?, ?)").run(
    threadId,
    what,
    usd,
    now(),
  );
}

export const threadSpend = (db: Db, threadId: string) =>
  Number(
    db.prepare("SELECT COALESCE(SUM(usd), 0) AS s FROM spend WHERE thread_id = ?").get(threadId)
      ?.s ?? 0,
  );

export const daySpend = (db: Db) =>
  Number(
    db
      .prepare("SELECT COALESCE(SUM(usd), 0) AS s FROM spend WHERE at >= ?")
      .get(new Date(Date.now() - 864e5).toISOString())?.s ?? 0,
  );

/** Approvals still waiting when the server stopped can't be answered any more. */
export function expireApprovals(db: Db) {
  for (const t of listThreads(db)) {
    for (const e of listEvents(db, t.id)) {
      if (e.type === "approval" && e.status === "pending")
        putEvent(db, t.id, { ...e, status: "denied" });
      // A question survives a restart: the thread still waits for the answer.
      if (e.type === "tool" && e.status === "running")
        putEvent(db, t.id, { ...e, status: "error", meta: "server restarted" });
    }
    if (t.status !== "idle") setStatus(db, t.id, pendingQuestion(db, t.id) ? "input" : "idle");
  }
}
