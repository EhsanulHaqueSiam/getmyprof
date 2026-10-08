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
    const fact = {
      kind: "other" as const,
      date: "",
      confirmed: true,
      question: false,
      planned: false,
    };
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

describe("the hunt's shape", () => {
  it("changes with the track, and asks for the sweep's reach, match and safety mix", () => {
    const prefs = {
      degrees: ["funded_ms" as const],
      intake: "Fall 2027",
      fallbackIntake: "",
      places: ["Germany"],
      fields: ["NLP"],
      adjacent: [],
      fundingFloor: "full" as const,
      preferTestWaivers: false,
      sweep: { reach: 2, match: 3, safety: 4 },
      priorities: ["money" as const],
      followUpDays: [7, 14] as [number, number],
    };
    const prompt = systemPrompt(
      { id: "h", name: "h", prefs },
      [],
      DEFAULT_SETTINGS,
      DEFAULT_APPLICANT,
    );
    expect(prompt).toContain("scholarships and program funding matter more than advisors");
    expect(prompt).toContain("about 2 reach, 3 match and 4 safety schools");
    expect(prompt).toContain("EURAXESS");
    // Professors who never post an opening still get found by what they work on.
    expect(prompt).toContain("propose everyone whose current work fits");
    // A first email is written for one professor: their paper, a short body, no generic praise.
    expect(prompt).toContain("name one recent paper of theirs by title and one concrete detail");
    expect(prompt).toContain("Under 150 words");
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
