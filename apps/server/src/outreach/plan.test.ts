import { describe, expect, it } from "vite-plus/test";
import {
  addBusinessDays,
  classifyMail,
  dailyCap,
  followUpDue,
  nextSlot,
  returnDate,
  workingTime,
  zonedInstant,
} from "./plan.ts";

const NY = "America/New_York";

describe("send slots", () => {
  const warmupStart = new Date("2026-10-05T00:00:00Z");

  it("waits for 08:00 on the next Tuesday to Thursday in the professor's timezone", () => {
    // Fri Oct 9 2026, noon UTC: next slot is Tue Oct 13, 08:00 New York (12:00 UTC, EDT).
    const slot = nextSlot({
      now: new Date("2026-10-09T12:00:00Z"),
      timeZone: NY,
      university: "GMU",
      scheduled: [],
      warmupStart,
    });
    expect(slot.toISOString()).toBe("2026-10-13T12:00:00.000Z");
  });

  it("spaces sends 5 minutes apart and keeps 2 a day per university", () => {
    const opening = zonedInstant(2026, 10, 13, 8, 0, NY);
    const scheduled = [
      { at: opening, university: "GMU" },
      { at: new Date(opening.getTime() + 5 * 6e4), university: "GMU" },
    ];
    const other = nextSlot({
      now: new Date("2026-10-09T12:00:00Z"),
      timeZone: NY,
      university: "UIC",
      scheduled,
      warmupStart,
    });
    expect(other.toISOString()).toBe("2026-10-13T12:10:00.000Z");
    const third = nextSlot({
      now: new Date("2026-10-09T12:00:00Z"),
      timeZone: NY,
      university: "GMU",
      scheduled,
      warmupStart,
    });
    expect(third.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });

  it("warms a new mailbox up: 5, then 10, then 15 a day", () => {
    expect(dailyCap(warmupStart, new Date("2026-10-07T12:00:00Z"))).toBe(5);
    expect(dailyCap(warmupStart, new Date("2026-10-13T12:00:00Z"))).toBe(10);
    expect(dailyCap(warmupStart, new Date("2026-10-28T12:00:00Z"))).toBe(15);
  });
});

describe("follow-ups", () => {
  it("come 7 and 14 business days after the first email, then stop", () => {
    const first = new Date("2026-10-07T12:00:00Z"); // a Wednesday
    expect(addBusinessDays(first, 7).toISOString().slice(0, 10)).toBe("2026-10-16");
    expect(followUpDue(first, 1)?.toISOString().slice(0, 10)).toBe("2026-10-27");
    expect(followUpDue(first, 2)).toBeNull();
  });
});

describe("classifyMail", () => {
  it("tells replies from bounces, out-of-office notes and LinkedIn notifications", () => {
    expect(
      classifyMail({
        from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: "Delivery Status Notification (Failure)",
        body: "",
      }),
    ).toBe("bounce");
    expect(
      classifyMail({ from: "prof@gmu.edu", subject: "Automatic reply: PhD 2027", body: "" }),
    ).toBe("auto-reply");
    expect(
      classifyMail({
        from: "messages-noreply@linkedin.com",
        subject: "Yulin sent you a message",
        body: "",
      }),
    ).toBe("linkedin");
    expect(
      classifyMail({
        from: "prof@gmu.edu",
        subject: "Re: PhD 2027",
        body: "Thanks, please send your CV.",
      }),
    ).toBe("reply");
  });
});

describe("out-of-office notes", () => {
  const now = new Date("2026-10-07T03:00:00Z");
  it("reads the return day the way the note writes it", () => {
    const day = (t: string) => returnDate(t, now)?.toISOString().slice(0, 10);
    expect(day("I am out of the office until October 17, 2026.")).toBe("2026-10-17");
    expect(day("Away until 17 October, back to email then")).toBe("2026-10-17");
    expect(day("Returning on Monday, January 4th.")).toBe("2027-01-04");
    expect(day("I'm traveling with limited access to email.")).toBeUndefined();
  });
});

describe("answer timing", () => {
  const at = (iso: string) => workingTime(new Date(iso), NY).toISOString();

  it("goes at once in the professor's working hours, else at 08:00 their next working day", () => {
    // Tue Oct 13 2026, 10:00 New York (14:00 UTC): at once.
    expect(at("2026-10-13T14:00:00Z")).toBe("2026-10-13T14:00:00.000Z");
    // Tue 06:00 New York: that morning at 08:00.
    expect(at("2026-10-13T10:00:00Z")).toBe("2026-10-13T12:00:00.000Z");
    // Fri Oct 16, 19:00 New York: Monday Oct 19, 08:00.
    expect(at("2026-10-16T23:00:00Z")).toBe("2026-10-19T12:00:00.000Z");
  });
});
