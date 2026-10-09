import { describe, expect, it } from "vite-plus/test";
import { programChance } from "./chance.ts";
import { Applicant, Professor } from "./domain.ts";
import { Program } from "./vault.ts";

const program = (over: Partial<Program>) =>
  Program.parse({
    id: "p",
    university: "George Mason University",
    name: "PhD IT",
    degree: "phd",
    deadline: "2026-12-01",
    fee: "$75",
    waiver: "",
    english: "IELTS 6.5",
    funding: "",
    gpaMin: "3.0 / 4.0",
    admitRate: "31% of PhD applicants, 2025 (department report)",
    url: "",
    sources: [],
    note: "",
    ...over,
  });
const applicant = (ielts: string, gpa = "3.62", gpaScale = "4.00") =>
  Applicant.parse({
    citizenship: ["Bangladesh"],
    residence: "Bangladesh",
    degreeYears: 4,
    gpa,
    gpaScale,
    tests: [{ name: "IELTS", status: "taken", date: "2026-06-14", score: ielts }],
    moi: false,
    feeBudgetUsd: null,
    dependents: false,
    minStipendUsd: null,
  });
const prof = (taking: string, moneyTier = 2) =>
  Professor.parse({
    key: "k",
    name: "Kevin Lybarger",
    university: "George Mason University",
    department: "",
    niche: "",
    fit: 5,
    moneyTier,
    taking,
    money: "",
    lasts: "",
    email: "",
    emailCheck: "",
    contact: "",
    stage: "replied",
    fitsBecause: "",
    website: "",
    sources: [],
    grants: [],
    origin: "app",
    updatedAt: "",
  });
const paper = {
  id: "f",
  text: "Clinical IE paper",
  source: "doi",
  kind: "paper" as const,
  date: "2025",
  confirmed: true,
  question: false,
  planned: false,
};

describe("a program's chance", () => {
  it("is likely when a professor there replied and nothing falls short", () => {
    const c = programChance(program({}), {
      applicant: applicant("7.0"),
      facts: [paper],
      records: [prof("yes, they replied 2026-10-14")],
    });
    expect(c.band).toBe("likely");
    expect(c.lines.map((l) => [l.what, l.status])).toEqual([
      ["English", "meets"],
      ["GPA", "meets"],
      ["Research", "meets"],
      ["Selectivity", "meets"],
      ["Faculty interest", "strong"],
    ]);
    expect(c.moves).toEqual([]);
  });

  it("is reach on a score short of the minimum, and says what would move it", () => {
    const c = programChance(program({}), {
      applicant: applicant("6.0"),
      facts: [],
      records: [prof("yes, they replied 2026-10-14")],
    });
    expect(c.band).toBe("reach");
    expect(c.lines[0]).toMatchObject({
      what: "English",
      status: "short",
      you: "needs IELTS 6.5, you have 6.0",
    });
    expect(c.moves).toEqual(["needs IELTS 6.5"]);
  });

  it("is reach at a very selective program until someone there replies; match between", () => {
    const selective = program({ admitRate: "7% of PhD applicants, 2025" });
    const ctx = { applicant: applicant("7.0"), facts: [paper] };
    expect(programChance(selective, { ...ctx, records: [] }).band).toBe("reach");
    expect(
      programChance(program({}), { ...ctx, records: [prof('yes: "recruiting" (their page)')] }),
    ).toMatchObject({
      band: "match",
      moves: ["a reply from a professor there with money"],
    });
  });

  it("never compares a GPA on another scale", () => {
    const c = programChance(program({}), {
      applicant: applicant("7.0", "8.9", "10"),
      facts: [],
      records: [],
    });
    expect(c.lines.find((l) => l.what === "GPA")?.status).toBe("unknown");
  });
});
