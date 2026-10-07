import { describe, expect, it } from "vite-plus/test";
import { openDb } from "../db.ts";
import { applyChanges, blankProfessor } from "../records.ts";
import { DEFAULT_APPLICANT, DEFAULT_SETTINGS } from "../state.ts";
import { systemPrompt } from "./prompt.ts";

describe("systemPrompt", () => {
  it("carries the applicant's eligibility and never invites a test score that isn't there", () => {
    const prompt = systemPrompt(null, [], DEFAULT_SETTINGS, {
      ...DEFAULT_APPLICANT,
      citizenship: ["Bangladesh"],
      moi: true,
    });
    expect(prompt).toContain("citizen of Bangladesh");
    expect(prompt).toContain("Never claim a score");
    expect(prompt).toContain("NSF GRFP need US citizens");
    expect(prompt).toContain("medium-of-instruction");
  });

  it("gives the agent only facts with proof", () => {
    const fact = { kind: "other" as const, date: "", confirmed: true, question: false };
    const prompt = systemPrompt(
      null,
      [
        { ...fact, id: "a", text: "Led a lab of five.", source: "cv.pdf" },
        { ...fact, id: "b", text: "Won a national award.", source: "" },
      ],
      DEFAULT_SETTINGS,
      DEFAULT_APPLICANT,
    );
    expect(prompt).toContain("Led a lab of five.");
    expect(prompt).not.toContain("Won a national award.");
  });
});

describe("money tier", () => {
  it("is stored as a number when a proposal sets it", () => {
    openDb(":memory:");
    const p = applyChanges(blankProfessor("A B", "Uni"), [
      { field: "moneyTier", from: "0", to: "2" },
    ]);
    expect(p.moneyTier).toBe(2);
  });
});
