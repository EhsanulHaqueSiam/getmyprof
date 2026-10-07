import { describe, expect, it } from "vite-plus/test";
import { stripCitations, uncitedClaims } from "./domain.ts";
import { draftIssues } from "./outreach.ts";

const fact = (id: string, source: string) => ({
  id,
  text: id,
  source,
  kind: "other" as const,
  confirmed: true,
  question: false,
});
const facts = [fact("f_team", "cv.pdf"), fact("f_award", "")];

describe("claims about the applicant", () => {
  it("flags what you did or earned without a citation, not questions or plans", () => {
    expect(
      uncitedClaims(
        "I'm applying for a funded PhD for Fall 2027. I led a team of five. My CGPA is 3.71. I published two papers [1]. Are you taking students?",
      ),
    ).toEqual(["I led a team of five.", "My CGPA is 3.71."]);
    expect(stripCitations("I published two papers [1]. It was fun [2].")).toBe(
      "I published two papers. It was fun.",
    );
  });
});

describe("draft issues", () => {
  const draft = {
    channel: "email" as const,
    touch: "first" as const,
    subject: "PhD 2027",
    body: "I led a team of five [1]. I won a national award [2].",
    citations: { "1": "f_team", "2": "f_award" },
  };
  const ctx = { facts, applicant: undefined, emailCheck: "ok, on the lab page" };

  it("blocks a claim whose fact has no proof, a third link and an unchecked address", () => {
    expect(draftIssues(draft, ctx)).toEqual(["[2] cites a fact without proof"]);
    expect(
      draftIssues(
        { ...draft, body: "See https://a.org https://b.org https://c.org [1]." },
        { ...ctx, emailCheck: "" },
      ),
    ).toEqual(["more than two links", "the address isn't checked yet: run Find and check emails"]);
  });

  it("lets a reply go to the address that wrote, and passes a clean draft", () => {
    const clean = { ...draft, body: "I led a team of five [1]. Are you taking students?" };
    expect(draftIssues(clean, ctx)).toEqual([]);
    expect(draftIssues({ ...clean, touch: "reply" }, { ...ctx, emailCheck: "" })).toEqual([]);
  });
});
