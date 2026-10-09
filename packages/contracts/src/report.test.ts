import { describe, expect, it } from "vite-plus/test";
import { Professor } from "./domain.ts";
import { OutreachMessage } from "./outreach.ts";
import { buildReport } from "./report.ts";
import { Program, School, VaultState } from "./vault.ts";

const school = (name: string, tier: "reach" | "match" | "safety", status = "kept") =>
  School.parse({
    id: name,
    name,
    country: "USA",
    tier,
    rank: "",
    admits: "committee",
    why: "",
    sources: [],
    status,
  });
const professor = (name: string, university: string) =>
  Professor.parse({
    key: name,
    name,
    university,
    department: "",
    niche: "",
    fit: 4,
    taking: "",
    money: "",
    lasts: "",
    email: "",
    emailCheck: "",
    contact: "",
    stage: "new",
    fitsBecause: "",
    website: "",
    sources: [],
    grants: [],
    origin: "app",
    updatedAt: "",
  });
const message = (recordKey: string, over: Partial<OutreachMessage>) =>
  OutreachMessage.parse({
    id: crypto.randomUUID(),
    recordKey,
    channel: "email",
    direction: "out",
    touch: "first",
    kind: null,
    replyClass: null,
    status: "sent",
    from: "",
    to: "",
    subject: "PhD 2027",
    body: "A private draft the report must never carry.",
    timeZone: "",
    scheduledAt: null,
    at: "2026-10-01T12:00:00Z",
    messageId: null,
    inReplyTo: null,
    threadId: null,
    note: "",
    createdAt: "2026-10-01T12:00:00Z",
    ...over,
  });

describe("the progress report", () => {
  it("counts the shortlist, replies and the next 30 days, and carries no message text", () => {
    const vault = VaultState.parse({
      documents: [],
      scholarships: [],
      applications: [],
      offers: [],
      writing: [],
      toFile: [],
      programs: [
        Program.parse({
          id: "p",
          university: "George Mason University",
          name: "PhD IT",
          degree: "phd",
          deadline: "2026-11-01",
          fee: "$75",
          waiver: "none found",
          english: "",
          funding: "",
          url: "",
          sources: [],
          note: "",
        }),
      ],
      schools: [
        school("University of Kansas", "safety"),
        school("George Mason University", "match"),
        school("Dropped University", "reach", "dropped"),
      ],
    });
    const report = buildReport({
      hunt: null,
      vault,
      records: [professor("Ada", "George Mason University"), professor("Bo", "Elsewhere")],
      messages: [
        message("Ada", {}),
        message("Ada", {
          direction: "in",
          touch: null,
          kind: "reply",
          status: "received",
          note: "asks for a CV",
          at: "2026-10-05T09:00:00Z",
        }),
        // An out-of-office isn't a reply.
        message("Bo", { direction: "in", touch: null, kind: "auto-reply", status: "received" }),
      ],
      applicant: undefined,
      now: new Date(2026, 9, 9),
    });
    expect(report.counts).toEqual({
      schools: 2,
      professors: 2,
      emailed: 1,
      replied: 1,
      applications: 0,
    });
    expect(report.shortlist).toEqual([
      {
        tier: "match",
        name: "George Mason University",
        professors: 1,
        emailed: 1,
        replied: 1,
        deadline: "2026-11-01",
      },
      {
        tier: "safety",
        name: "University of Kansas",
        professors: 0,
        emailed: 0,
        replied: 0,
        deadline: null,
      },
    ]);
    expect(report.replies).toEqual([
      {
        name: "Ada",
        university: "George Mason University",
        note: "asks for a CV",
        at: "2026-10-05T09:00:00Z",
      },
    ]);
    // The deadline 23 days out is in; nothing private is.
    expect(report.upcoming.map((u) => u.date)).toContain("2026-11-01");
    expect(JSON.stringify(report)).not.toContain("private draft");
  });
});
