import { describe, expect, it } from "vite-plus/test";
import { feeBudget, scoreGaps, usdFee } from "./applying.ts";
import { Application, Program, type VaultState } from "./vault.ts";

type Tests = Parameters<typeof scoreGaps>[1]["tests"];
const taken = (name: string, score: string) => ({
  name,
  status: "taken" as const,
  date: "",
  score,
});
const me = (tests: Tests, moi = false) => ({ tests, moi });

describe("score gaps", () => {
  it("compares each minimum the program names with the applicant's taken scores", () => {
    const ielts = me([taken("IELTS Academic", "6.5")]);
    expect(scoreGaps("IELTS 7.0 overall", ielts)).toEqual(["needs IELTS 7.0, you have 6.5"]);
    expect(scoreGaps("IELTS 6.5; no band below 6", ielts)).toEqual([]);
    expect(scoreGaps("minimum TOEFL of 100", me([]))).toEqual(["needs TOEFL 100, none taken"]);
    // One English test that meets its minimum is enough.
    expect(scoreGaps("TOEFL iBT 90 or IELTS 6.5", ielts)).toEqual([]);
    expect(scoreGaps("TOEFL iBT 90 or IELTS 6.5 or PTE 65", me([]))).toEqual([
      "needs IELTS 6.5 or TOEFL 90 or PTE 65, none taken",
    ]);
    // A booked test is not a score.
    expect(
      scoreGaps("Duolingo 120", me([{ name: "Duolingo", status: "booked", date: "", score: "" }])),
    ).toEqual(["needs Duolingo 120, none taken"]);
  });

  it("reads GRE apart from English, and skips it when optional", () => {
    expect(scoreGaps("IELTS 6.5; GRE 310", me([taken("IELTS", "7"), taken("GRE", "305")]))).toEqual(
      ["needs GRE 310, you have 305"],
    );
    expect(scoreGaps("GRE optional; IELTS 6.5", me([taken("IELTS", "7")]))).toEqual([]);
    // Scores from 2024 are a year, not a minimum.
    expect(scoreGaps("IELTS scores from 2024 accepted", me([]))).toEqual([]);
  });

  it("lets an MOI certificate stand in where the program accepts one", () => {
    expect(scoreGaps("IELTS 7.0; MOI accepted", me([], true))).toEqual([]);
    expect(scoreGaps("IELTS 7.0; MOI accepted", me([]))).toEqual(["needs IELTS 7.0, none taken"]);
    // "Considered" is not a promise.
    expect(scoreGaps("IELTS 6.5; MOI considered", me([], true))).toEqual([
      "needs IELTS 6.5, none taken",
    ]);
  });
});

describe("the fee budget", () => {
  it("reads dollar fees and refuses other currencies", () => {
    expect(["$75", "USD 90", "75 USD", "US$1,000", "none", "C$100", "£80", ""].map(usdFee)).toEqual(
      [75, 90, 75, 1000, 0, null, null, null],
    );
  });

  it("counts live applications, free with a granted waiver, unpaid if only applying when waived", () => {
    const program = (id: string, fee: string) =>
      Program.parse({
        id,
        university: id,
        name: "PhD",
        degree: "phd",
        deadline: null,
        fee,
        waiver: "",
        english: "",
        funding: "",
        url: "",
        sources: [],
        note: "",
      });
    const app = (programId: string, over: Partial<Application> = {}) =>
      Application.parse({
        id: programId,
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
    const v: VaultState = {
      documents: [],
      scholarships: [],
      offers: [],
      writing: [],
      toFile: [],
      schools: [],
      programs: [
        program("gmu", "$75"),
        program("uic", "USD 90"),
        program("ksu", "$65"),
        program("umd", "$125"),
        program("rejected", "$100"),
        program("ed", "£80"),
      ],
      applications: [
        app("gmu", { status: "submitted" }),
        app("uic", { waiver: "requested" }),
        app("ksu", { waiver: "granted" }),
        app("umd", { waiver: "requested", onlyIfWaived: true }),
        app("rejected", { status: "rejected" }),
        app("ed"),
      ],
    };
    expect(feeBudget(v, { feeBudgetUsd: 150 })).toEqual({
      spent: 165,
      waived: 65,
      pending: 2,
      unknown: ["ed: £80"],
      budget: 150,
      over: true,
    });
    expect(feeBudget(v, { feeBudgetUsd: null }).over).toBe(false);
  });
});
