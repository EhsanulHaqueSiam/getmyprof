import { describe, expect, it } from "vite-plus/test";
import { calendarFeed, calendarIcs } from "./calendar.ts";
import { openDb } from "./db.ts";
import { getSettings } from "./state.ts";

describe("the calendar feed", () => {
  it("writes one all-day event per deadline, escaped and folded at 75 octets", () => {
    const ics = calendarIcs(
      [
        {
          id: "program-p1",
          date: "2026-12-01",
          kind: "program",
          title: "George Mason University · PhD in Information Technology due",
          detail: "planning; 2 items left, fee $75",
          url: "https://cec.gmu.edu/phd",
        },
        {
          id: "letters-a1",
          date: "2026-10-20",
          kind: "letters",
          title: "GMU: ask your recommenders",
          detail: "",
          url: "",
        },
      ],
      new Date("2026-10-09T08:00:00Z"),
    );
    expect(ics.split("\r\n")).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//getmyprof//deadlines//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:getmyprof",
      "BEGIN:VEVENT",
      "UID:program-p1@getmyprof",
      "DTSTAMP:20261009T080000Z",
      "DTSTART;VALUE=DATE:20261201",
      "SUMMARY:George Mason University · PhD in Information Technology due",
      "DESCRIPTION:planning\\; 2 items left\\, fee $75",
      "URL:https://cec.gmu.edu/phd",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:letters-a1@getmyprof",
      "DTSTAMP:20261009T080000Z",
      "DTSTART;VALUE=DATE:20261020",
      "SUMMARY:GMU: ask your recommenders",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
    // "é" is two octets: the first line holds 33 of them after "SUMMARY:", the rest continue.
    const long = calendarIcs([
      { id: "x", date: "2026-12-01", kind: "test", title: "é".repeat(50), detail: "", url: "" },
    ]);
    const summary = long.split("\r\n").filter((l) => l.startsWith("SUMMARY") || l.startsWith(" "));
    expect(summary.map((l) => new TextEncoder().encode(l).length)).toEqual([74, 35]);
    expect(
      summary
        .join("")
        .replace(/^SUMMARY:/, "")
        .replaceAll(" ", ""),
    ).toBe("é".repeat(50));
  });

  it("answers only to the MCP token", () => {
    const db = openDb(":memory:");
    expect(calendarFeed(db, "/api/calendar.ics")).toBeNull();
    expect(calendarFeed(db, "/api/calendar.ics?token=wrong")).toBeNull();
    expect(calendarFeed(db, `/api/calendar.ics?token=${getSettings(db).mcpToken}`)).toContain(
      "BEGIN:VCALENDAR",
    );
  });
});
