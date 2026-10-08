import type { Professor, School } from "@getmyprof/contracts";
import { describe, expect, it } from "vite-plus/test";
import { afterRent, schoolRows, suggestPrompt } from "./schools";

const school = (id: string, name: string, over: Partial<School> = {}): School => ({
  id,
  name,
  country: "USA",
  tier: "match",
  rank: "",
  admits: "committee",
  why: "",
  stipendUsd: null,
  rentUsd: null,
  sources: [],
  status: "kept",
  ...over,
});
const prof = (
  university: string,
  over: Partial<Pick<Professor, "moneyTier" | "stage">> = {},
): Pick<Professor, "university" | "moneyTier" | "stage"> => ({
  university,
  moneyTier: 0,
  stage: "new",
  ...over,
});
const program = (university: string, deadline: string | null) => ({ university, deadline });

describe("the shortlist", () => {
  it("joins each professor and program to one school, and counts money and mail", () => {
    const uic = school("uic", "University of Illinois Chicago");
    const uchicago = school("uc", "University of Chicago");
    const [a, b] = schoolRows(
      [uic, uchicago],
      [
        program("University of Illinois Chicago", null),
        program("University of Illinois Chicago", "2026-12-15"),
      ],
      [
        prof("University of Illinois Chicago", { moneyTier: 2, stage: "sent" }),
        prof("University of Illinois Chicago", { moneyTier: 3 }),
        prof("University of Chicago", { stage: "replied" }),
      ],
    );
    expect(a).toMatchObject({ funded: 1, emailed: 1, program: { deadline: "2026-12-15" } });
    expect(a?.professors).toHaveLength(2);
    expect(b).toMatchObject({ funded: 0, emailed: 1, program: null });
    expect(b?.professors).toHaveLength(1);
  });

  it("asks for what each tier still lacks, at least one, not counting dropped schools", () => {
    const schools = [
      school("a", "A", { tier: "reach" }),
      school("b", "B", { tier: "reach", status: "suggested" }),
      school("c", "C", { tier: "safety", status: "dropped" }),
      school("d", "D", { tier: "match" }),
      school("e", "E", { tier: "match" }),
      school("f", "F", { tier: "match" }),
    ];
    expect(suggestPrompt(schools, { reach: 3, match: 3, safety: 2 })).toBe(
      "Suggest schools for my shortlist: 1 reach, 1 match, 2 safety.",
    );
  });

  it("says what a stipend leaves after a year of rent, once both are known", () => {
    expect(afterRent({ stipendUsd: 32000, rentUsd: 1100 })).toEqual({
      text: "$18.8k after rent",
      title: "stipend $32,000 a year, rent $1,100 a month",
    });
    // With dependents, a family home: 1.4 times the rent.
    expect(afterRent({ stipendUsd: 20000, rentUsd: 1500 }, true)?.text).toBe("-$5.2k after rent");
    expect(afterRent({ stipendUsd: 32000, rentUsd: null })).toBeNull();
  });
});
