import { describe, expect, it } from "vite-plus/test";
import { capProblem } from "./agent/tools.ts";
import { openDb } from "./db.ts";
import { fillPlaceholders, hookLoop, nextRun, saveLoop } from "./loops.ts";
import { intakeStart, monthsAfter } from "./sources.ts";
import { DEFAULT_SETTINGS } from "./state.ts";
import { createThread } from "./threads.ts";

describe("nextRun", () => {
  const from = new Date(2026, 9, 7, 9, 30); // Wed Oct 7 2026, 09:30 local

  it("runs daily at the next occurrence of the time", () => {
    expect(nextRun({ kind: "daily", at: "23:00" }, from)).toEqual(new Date(2026, 9, 7, 23, 0));
    expect(nextRun({ kind: "daily", at: "08:00" }, from)).toEqual(new Date(2026, 9, 8, 8, 0));
  });

  it("runs weekly on the given weekday, a week out when today's slot passed", () => {
    expect(nextRun({ kind: "weekly", day: 1, at: "08:00" }, from)).toEqual(
      new Date(2026, 9, 12, 8, 0),
    );
    expect(nextRun({ kind: "weekly", day: 3, at: "09:00" }, from)).toEqual(
      new Date(2026, 9, 14, 9, 0),
    );
  });

  it("runs every N hours from the last run", () => {
    expect(nextRun({ kind: "every", hours: 6 }, from)).toEqual(new Date(2026, 9, 7, 15, 30));
  });

  it("runs at a time on chosen weekdays, or every day when none are chosen", () => {
    // Tuesday and Thursday at 08:00, from Wednesday 09:30: Thursday.
    expect(nextRun({ kind: "at", at: "08:00", weekdays: [2, 4] }, from)).toEqual(
      new Date(2026, 9, 8, 8, 0),
    );
    expect(nextRun({ kind: "at", at: "23:00", weekdays: [] }, from)).toEqual(
      new Date(2026, 9, 7, 23, 0),
    );
    expect(nextRun({ kind: "webhook" }, from)).toBeNull();
  });
});

describe("a webhook loop", () => {
  it("keeps its secret across saves, answers only to it, and fills placeholders from the body", () => {
    const db = openDb(":memory:");
    const base = {
      name: "New award posted",
      instructions: "Vet {{body.pi}} at {{body.org.name}}, award {{body.id}}.{{body.missing}}",
      schedule: { kind: "webhook" as const },
      budgetUsd: 0.5,
      enabled: true,
    };
    const loop = saveLoop(db, base);
    expect(loop.hookToken).toMatch(/^[\w-]{24}$/);
    expect(saveLoop(db, { ...base, id: loop.id }).hookToken).toBe(loop.hookToken);
    expect(hookLoop(db, loop.hookToken ?? "")?.id).toBe(loop.id);
    expect(hookLoop(db, "not-the-token")).toBeNull();
    expect(
      fillPlaceholders(base.instructions, { pi: "Ge Gao", org: { name: "UMD" }, id: 2443387 }),
    ).toBe("Vet Ge Gao at UMD, award 2443387.");
  });
});

describe("a loop run's cap", () => {
  it("is its own loop's budget, not the default", () => {
    const db = openDb(":memory:");
    const loop = saveLoop(db, {
      name: "Nightly sweep",
      instructions: "Sweep.",
      schedule: { kind: "daily", at: "02:00" },
      budgetUsd: 0.1,
      enabled: true,
    });
    const run = { db, settings: DEFAULT_SETTINGS, threadId: createThread(db, "run", loop.id).id };
    expect(capProblem(run, 0.2)).toBe("This would pass the $0.1 cap for this loop run.");
    expect(capProblem(run, 0.05)).toBeNull();
  });
});

describe("intake math", () => {
  it("counts months an award runs past the intake", () => {
    const fall = intakeStart("Fall 2027");
    expect(fall?.toISOString().slice(0, 10)).toBe("2027-09-01");
    expect(monthsAfter("2030-05-31", fall)).toBe(32);
    expect(monthsAfter("2026-12-31", fall)).toBeLessThan(0);
    expect(intakeStart("Spring 2028")?.toISOString().slice(0, 10)).toBe("2028-01-15");
    expect(monthsAfter(null, fall)).toBeNull();
  });
});
