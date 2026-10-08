import { describe, expect, it } from "vite-plus/test";
import { deadlines } from "./deadlines.ts";
import { Application, Program, VaultState } from "./vault.ts";

const program = (id: string, deadline: string | null, waiver = "none found") =>
  Program.parse({
    id,
    university: id.toUpperCase(),
    name: "PhD CS",
    degree: "phd",
    deadline,
    fee: "$75",
    waiver,
    english: "",
    funding: "",
    url: `https://${id}.edu/phd`,
    sources: [],
    note: "",
  });
const application = (programId: string, over: Partial<Application> = {}) =>
  Application.parse({
    id: `app-${programId}`,
    programId,
    status: "planning",
    waiver: "none",
    documents: [],
    recommenders: [],
    portal: "",
    portalStatus: "",
    professors: [],
    submittedAt: null,
    note: "",
    ...over,
  });
const vault = (over: Partial<VaultState>): VaultState => ({
  documents: [],
  scholarships: [],
  programs: [],
  applications: [],
  offers: [],
  writing: [],
  toFile: [],
  schools: [],
  ...over,
});

describe("the deadline list", () => {
  const now = new Date(2026, 9, 9);

  it("dates every program, the waiver and letter asks before it, and keeps them in order", () => {
    const v = vault({
      programs: [
        program("gmu", "2026-12-01", "on request for international applicants"),
        // No application yet still gets its deadline; its waiver was never on request.
        program("uic", "2026-12-15"),
      ],
      applications: [
        application("gmu", {
          recommenders: [{ name: "A", email: "", status: "asked" }],
        }),
      ],
    });
    expect(deadlines(v, undefined, now).map((d) => [d.date, d.kind, d.title, d.detail])).toEqual([
      [
        "2026-10-20",
        "letters",
        "GMU: ask your recommenders",
        "1 of 3 asked, letters due 2026-12-01",
      ],
      [
        "2026-11-10",
        "waiver",
        "Ask GMU for a fee waiver",
        "Waiver on request for international applicants; fee $75, deadline 2026-12-01",
      ],
      ["2026-12-01", "program", "GMU · PhD CS due", "planning · fee $75"],
      ["2026-12-15", "program", "UIC · PhD CS due", "no application yet · fee $75"],
    ]);
  });

  it("asks today when the ask-by date has passed, and drops the ask once the deadline has", () => {
    const v = vault({
      programs: [
        program("soon", "2026-10-20", "on request"),
        program("gone", "2026-10-01", "on request"),
        program("won", "2026-12-01", "on request"),
      ],
      applications: [
        application("soon"),
        application("gone"),
        // A granted waiver needs no asking, and three letters asked need no reminder.
        application("won", {
          waiver: "granted",
          recommenders: ["A", "B", "C"].map((name) => ({ name, email: "", status: "agreed" })),
        }),
      ],
    });
    expect(deadlines(v, undefined, now).map((d) => `${d.date} ${d.kind} ${d.id}`)).toEqual([
      "2026-10-01 program program-gone",
      "2026-10-09 waiver waiver-soon",
      "2026-10-09 letters letters-app-soon",
      "2026-10-20 program program-soon",
      "2026-12-01 program program-won",
    ]);
  });

  it("adds open scholarships, booked tests, interviews, offers to answer and expiring documents", () => {
    const v = vault({
      programs: [program("gmu", "2026-12-01")],
      applications: [
        application("gmu", {
          status: "interview",
          interviews: [{ id: "i1", with: "Kevin Lybarger", at: "2026-12-10T09:30" }],
        }),
      ],
      scholarships: [
        {
          id: "s1",
          name: "Fulbright",
          sponsor: "US State Dept",
          studyIn: "USA",
          citizenship: [],
          tracks: ["phd"],
          amount: "",
          deadline: "2027-02-15",
          url: "",
          sources: [],
          status: "watch",
          note: "",
        },
        {
          id: "s2",
          name: "Lost one",
          sponsor: "",
          studyIn: "",
          citizenship: [],
          tracks: [],
          amount: "",
          deadline: "2026-11-01",
          url: "",
          sources: [],
          status: "lost",
          note: "",
        },
      ],
      offers: [
        {
          id: "o1",
          university: "GMU",
          program: "PhD CS",
          stipend: null,
          stipendPer: "year",
          currency: "USD",
          tuition: "full",
          years: 5,
          insurance: "",
          duties: "",
          rentPerMonth: null,
          respondBy: "2027-04-15",
          status: "open",
          note: "",
        },
      ],
      documents: [
        {
          id: "d1",
          name: "passport.pdf",
          kind: "passport",
          mime: "",
          size: 1,
          expires: "2027-03-01",
          uploadedAt: "",
          sha256: "",
        },
      ],
    });
    const tests = [
      { name: "IELTS Academic", status: "booked" as const, date: "2026-12-05", score: "" },
      { name: "GRE", status: "taken" as const, date: "2026-08-01", score: "320" },
      { name: "TOEFL", status: "planned" as const, date: "", score: "" },
    ];
    expect(deadlines(v, { tests }, now).map((d) => `${d.date} ${d.title} | ${d.detail}`)).toEqual([
      "2026-12-01 GMU · PhD CS due | interview · fee $75",
      "2026-12-05 IELTS Academic | Lands after GMU's deadline, 2026-12-01",
      "2026-12-10 Interview with Kevin Lybarger (GMU) | at 09:30",
      "2027-02-15 Fulbright closes | US State Dept · watch",
      "2027-03-01 passport.pdf expires | passport",
      "2027-04-15 Answer GMU's offer | PhD CS",
    ]);
  });
});
