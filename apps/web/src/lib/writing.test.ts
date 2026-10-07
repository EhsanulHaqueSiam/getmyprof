import type { Applicant, ProfileFact, Writing } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { checks, citations, layout, plainText, strayMarkers } from "./writing";

const fact = (id: string, f: Partial<ProfileFact> = {}): ProfileFact => ({
  id,
  text: id,
  source: "cv.pdf",
  kind: "other",
  confirmed: true,
  question: false,
  ...f,
});

const piece: Writing = {
  id: "w1",
  kind: "sop",
  title: "SOP",
  programId: null,
  scholarshipId: null,
  draft: 1,
  body: "I did a BSc [1]. I led a team of five [2]. Lybarger's work fits.\n\nIELTS 7.5 later [3].",
  citations: { "1": "f_bsc", "2": "f_team" },
  threadId: null,
  updatedAt: "",
  history: [],
};

const applicant: Applicant = {
  citizenship: [],
  residence: "",
  degreeYears: 4,
  gpa: "",
  tests: [],
  moi: false,
  feeBudgetUsd: null,
  dependents: false,
  minStipendUsd: null,
};

describe("the Writer's reading of a piece", () => {
  it("blocks the sentence whose fact has no proof, and flags a marker with no citation", () => {
    const cited = citations(piece, [fact("f_bsc"), fact("f_team", { source: "" })]);
    expect(cited.map((c) => `${c.n}:${c.ok}`)).toEqual(["1:true", "2:false"]);
    const blocked = new Set(cited.filter((c) => !c.ok).map((c) => c.n));
    const [first] = layout(piece, blocked);
    expect(first?.sentences.map((s) => s.blocked)).toEqual([false, true, false]);
    expect(strayMarkers(piece)).toEqual(["3"]);
  });

  it("catches a test score no fact backs, names professors by last name, and exports clean text", () => {
    const c = checks(piece, { named: ["Kevin Lybarger", "Ziyu Yao"], applicant });
    expect(c).toMatchObject({ namedFound: 1, namedTotal: 2, scoreClaimed: true, emDashes: 0 });
    const taken = {
      ...applicant,
      tests: [{ name: "IELTS", status: "taken" as const, date: "", score: "7.5" }],
    };
    expect(checks(piece, { named: [], applicant: taken }).scoreClaimed).toBe(false);
    expect(plainText(piece)).toBe(
      "I did a BSc. I led a team of five. Lybarger's work fits.\n\nIELTS 7.5 later.",
    );
  });
});
