import { Loop, type Schedule } from "@gradcode/contracts";
import { type Db, newId } from "./db.ts";

const at = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return { h, m };
};

/** The next time a schedule fires after `from`, in local time. */
export function nextRun(schedule: Schedule, from: Date): Date {
  if (schedule.kind === "every") return new Date(from.getTime() + schedule.hours * 36e5);
  const { h, m } = at(schedule.at);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (schedule.kind === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }
  const ahead = (schedule.day - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + ahead);
  if (next <= from) next.setDate(next.getDate() + 7);
  return next;
}

const parse = (r: Record<string, unknown>) => Loop.parse(JSON.parse(String(r.body)));

export const listLoops = (db: Db) =>
  db
    .prepare("SELECT body FROM loops")
    .all()
    .map(parse)
    .toSorted((a, b) => a.name.localeCompare(b.name));

export function saveLoop(
  db: Db,
  input: Omit<Loop, "id" | "lastRunAt" | "nextRunAt" | "lastSummary"> & { id?: string | undefined },
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
    nextRunAt: input.enabled ? nextRun(input.schedule, new Date()).toISOString() : null,
  };
  db.prepare(
    "INSERT INTO loops (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
  ).run(loop.id, JSON.stringify(loop));
  return loop;
}

export function markRan(db: Db, loop: Loop, ranAt: Date) {
  const next: Loop = {
    ...loop,
    lastRunAt: ranAt.toISOString(),
    nextRunAt: loop.enabled ? nextRun(loop.schedule, ranAt).toISOString() : null,
  };
  db.prepare("UPDATE loops SET body = ? WHERE id = ?").run(JSON.stringify(next), loop.id);
  return next;
}

export const dueLoops = (db: Db, nowAt = new Date()) =>
  listLoops(db).filter((l) => l.enabled && l.nextRunAt !== null && new Date(l.nextRunAt) <= nowAt);

/** The loops first run offers, written as instructions the agent can follow. */
export const STARTER_LOOPS = [
  {
    name: "Nightly sweep",
    instructions:
      "Pick the next school that fits my preferences and isn't in my sheet yet (use sheet_search). Sweep its department for professors in my fields and adjacent domains who can fund a student for my intake. Propose each one.",
    schedule: { kind: "daily", at: "23:00" },
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
    schedule: { kind: "weekly", day: 1, at: "08:00" },
  },
  {
    name: "Deadline watch",
    instructions:
      "Check the program pages of schools in my sheet for application deadlines, fees and English test rules for my intake. Report what changed.",
    schedule: { kind: "weekly", day: 0, at: "09:00" },
  },
] satisfies { name: string; instructions: string; schedule: Schedule }[];
