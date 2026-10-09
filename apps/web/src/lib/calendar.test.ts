import type { Deadline, DeadlineKind } from "@getmyprof/contracts";
import { describe, expect, it } from "vite-plus/test";
import { calendarGroups } from "./calendar";

const item = (date: string, kind: DeadlineKind = "program"): Deadline => ({
  id: `${kind}-${date}`,
  date,
  kind,
  title: `${kind} on ${date}`,
  detail: "",
  url: "",
});

// Thursday, Oct 29 2026: this week runs Mon Oct 26 to Sun Nov 1.
const now = new Date(2026, 9, 29, 10);

describe("the Calendar", () => {
  it("groups by week across a month boundary, then by month", () => {
    const groups = calendarGroups(
      ["2026-10-20", "2026-10-29", "2026-11-01", "2026-11-02", "2026-11-08", "2026-11-09"]
        .map((d) => item(d))
        .concat(item("2027-01-10")),
      "All",
      now,
    );
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.date)])).toEqual([
      ["Earlier", ["2026-10-20"]],
      ["This week · Oct 26 to Nov 1", ["2026-10-29", "2026-11-01"]],
      ["Next week · Nov 2 to 8", ["2026-11-02", "2026-11-08"]],
      ["November", ["2026-11-09"]],
      ["January 2027", ["2027-01-10"]],
    ]);
  });

  it("maps each filter to its kinds, with interviews and documents under All only", () => {
    const kinds: DeadlineKind[] = [
      "program",
      "waiver",
      "scholarship",
      "test",
      "letters",
      "interview",
      "offer",
      "document",
    ];
    const items = kinds.map((k) => item("2026-11-20", k));
    const shown = (f: Parameters<typeof calendarGroups>[1]) =>
      calendarGroups(items, f, now).flatMap((g) => g.rows.map((r) => r.kind));
    expect(shown("All")).toEqual(kinds);
    expect(shown("Programs")).toEqual(["program"]);
    expect(shown("Money")).toEqual(["waiver", "scholarship", "offer"]);
    expect(shown("Tests")).toEqual(["test"]);
    expect(shown("Letters")).toEqual(["letters"]);
  });

  it("says how far off each date is, in the warning tone within a week", () => {
    const rows = calendarGroups(
      ["2026-10-27", "2026-10-29", "2026-11-05", "2026-11-06"].map((d) => item(d)),
      "All",
      now,
    ).flatMap((g) => g.rows);
    expect(rows.map((r) => [r.day, r.due, r.soon])).toEqual([
      ["Oct 27", "2 days ago", false],
      ["Oct 29", "today", true],
      ["Nov 5", "in 7 days", true],
      ["Nov 6", "in 8 days", false],
    ]);
  });
});
