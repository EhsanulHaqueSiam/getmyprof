import { Loop, type Schedule } from "@gradcode/contracts";
import * as NodeCrypto from "node:crypto";
import { type Db, newId } from "./db.ts";
import { acceptedOffer } from "./vault.ts";

const clock = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return { h, m };
};

/** The older daily and weekly forms, read as "at a time on these weekdays". */
const asAt = (s: Schedule) =>
  s.kind === "daily"
    ? { at: s.at, weekdays: [] }
    : s.kind === "weekly"
      ? { at: s.at, weekdays: [s.day] }
      : s.kind === "at"
        ? s
        : null;

/** The next time a schedule fires after `from`, in the server's local time. Webhooks never do. */
export function nextRun(schedule: Schedule, from: Date): Date | null {
  if (schedule.kind === "every") return new Date(from.getTime() + schedule.hours * 36e5);
  const at = asAt(schedule);
  if (!at) return null;
  const { h, m } = clock(at.at);
  for (let i = 0; i <= 7; i++) {
    const next = new Date(from);
    next.setDate(next.getDate() + i);
    next.setHours(h, m, 0, 0);
    const dayOk = at.weekdays.length === 0 || at.weekdays.includes(next.getDay());
    if (dayOk && next > from) return next;
  }
  return null;
}

/** "{{body.pr.title}}" in a webhook loop's instructions becomes that value from the request body. */
export function fillPlaceholders(text: string, body: unknown) {
  return text.replace(/\{\{\s*body((?:\.[\w-]+)*)\s*\}\}/g, (_, path: string) => {
    let v: unknown = body;
    for (const key of path.split(".").filter(Boolean))
      v = v && typeof v === "object" ? Object.entries(v).find(([k]) => k === key)?.[1] : undefined;
    return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  });
}

const parse = (r: Record<string, unknown>) => Loop.parse(JSON.parse(String(r.body)));

export const listLoops = (db: Db) =>
  db
    .prepare("SELECT body FROM loops")
    .all()
    .map(parse)
    .toSorted((a, b) => a.name.localeCompare(b.name));

const putLoop = (db: Db, loop: Loop) =>
  db
    .prepare(
      "INSERT INTO loops (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
    )
    .run(loop.id, JSON.stringify(loop));

export function saveLoop(
  db: Db,
  input: Pick<Loop, "name" | "instructions" | "schedule" | "budgetUsd" | "enabled"> & {
    id?: string | undefined;
    reportTo?: Loop["reportTo"] | undefined;
  },
) {
  const existing = input.id ? listLoops(db).find((l) => l.id === input.id) : undefined;
  const loop: Loop = {
    id: existing?.id ?? newId("loop"),
    name: input.name,
    instructions: input.instructions,
    schedule: input.schedule,
    budgetUsd: input.budgetUsd,
    enabled: input.enabled,
    lastRunAt: existing?.lastRunAt ?? null,
    lastSummary: existing?.lastSummary ?? "",
    nextRunAt: input.enabled ? (nextRun(input.schedule, new Date())?.toISOString() ?? null) : null,
    reportTo: input.reportTo ?? existing?.reportTo ?? "fresh",
    threadId: existing?.threadId ?? null,
    // A webhook's secret is made once and kept, so the URL a sender holds stays valid.
    hookToken:
      input.schedule.kind === "webhook"
        ? (existing?.hookToken ?? NodeCrypto.randomBytes(18).toString("base64url"))
        : null,
  };
  putLoop(db, loop);
  return loop;
}

/** Records a run: when it happened, the next time, and the thread a "same" loop reports to. */
export function markRan(db: Db, loop: Loop, ranAt: Date, threadId: string) {
  const next: Loop = {
    ...loop,
    lastRunAt: ranAt.toISOString(),
    nextRunAt: loop.enabled ? (nextRun(loop.schedule, ranAt)?.toISOString() ?? null) : null,
    threadId: loop.reportTo === "same" ? threadId : loop.threadId,
  };
  putLoop(db, next);
  return next;
}

/** Loops whose time has come. None once an offer is accepted: the hunt is over (Run now still works). */
export const dueLoops = (db: Db, nowAt = new Date()) =>
  acceptedOffer(db)
    ? []
    : listLoops(db).filter(
        (l) => l.enabled && l.nextRunAt !== null && new Date(l.nextRunAt) <= nowAt,
      );

/** The enabled webhook loop a token belongs to, compared in constant time. */
export function hookLoop(db: Db, token: string) {
  const given = Buffer.from(token);
  return (
    listLoops(db).find((l) => {
      if (!l.enabled || l.schedule.kind !== "webhook" || !l.hookToken) return false;
      const mine = Buffer.from(l.hookToken);
      return mine.length === given.length && NodeCrypto.timingSafeEqual(mine, given);
    }) ?? null
  );
}

/** The loops first run offers, written as instructions the agent can follow. */
export const STARTER_LOOPS = [
  {
    name: "Nightly sweep",
    instructions:
      "Pick the next school that fits my preferences and isn't in my sheet yet (use sheet_search). Sweep its department for professors in my fields and adjacent domains who can fund a student for my intake. Propose each one.",
    schedule: { kind: "at", at: "23:00", weekdays: [] },
  },
  {
    name: "Recruiting watch",
    instructions:
      "For professors in my sheet with fit 4 or more, re-read their homepage or lab page. Propose an update when 'taking students' or their contact rule changed.",
    schedule: { kind: "every", hours: 6 },
  },
  {
    name: "New awards",
    instructions:
      "Search NSF and NIH for awards in my fields at schools in my sheet. Propose each PI who isn't in my sheet yet, with the award as evidence and how long it lasts after my intake.",
    schedule: { kind: "at", at: "08:00", weekdays: [1] },
  },
  {
    name: "Deadline watch",
    instructions:
      "Check the program pages of schools in my sheet for application deadlines, fees and English test rules for my intake. Report what changed.",
    schedule: { kind: "at", at: "09:00", weekdays: [0] },
  },
] satisfies { name: string; instructions: string; schedule: Schedule }[];
