import { describe, expect, it } from "vite-plus/test";
import { nextRun } from "./loops.ts";
import { intakeStart, monthsAfter } from "./sources.ts";

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
