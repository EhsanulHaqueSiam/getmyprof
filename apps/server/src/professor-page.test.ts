import type { Award, Proposal } from "@getmyprof/contracts";
import { describe, expect, it } from "vite-plus/test";
import { fieldSources, timeline } from "./professor-page.ts";
import { blankProfessor, professorFromAward } from "./records.ts";

const proposal = (over: Partial<Proposal>): Proposal => ({
  id: "p",
  threadId: "t",
  recordKey: "k",
  recordName: "Ada",
  university: "GMU",
  kind: "update",
  changes: [],
  sources: [],
  status: "accepted",
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("a professor page", () => {
  it("links each field to the latest accepted change's sources and date", () => {
    const sources = fieldSources([
      proposal({
        changes: [{ field: "email", from: "", to: "a@gmu.edu" }],
        sources: ["https://old.gmu.edu"],
      }),
      proposal({
        createdAt: "2026-10-04T00:00:00Z",
        changes: [{ field: "email", from: "a@gmu.edu", to: "ada@gmu.edu" }],
        sources: ["https://cs.gmu.edu/ada"],
      }),
      // A rejected change proves nothing.
      proposal({
        status: "rejected",
        createdAt: "2026-10-05T00:00:00Z",
        changes: [{ field: "email", from: "", to: "x@y.z" }],
        sources: ["https://spam.example"],
      }),
    ]);
    expect(sources.email).toEqual({
      sources: ["https://cs.gmu.edu/ada"],
      at: "2026-10-04T00:00:00Z",
    });
  });

  it("lists what happened, newest first", () => {
    const lines = timeline(
      [
        proposal({ kind: "add", createdAt: "2026-08-27T00:00:00Z" }),
        proposal({ changes: [{ field: "emailCheck", from: "", to: "ok" }] }),
        proposal({ status: "pending", createdAt: "2026-10-09T00:00:00Z" }),
      ],
      [],
    );
    expect(lines.map((l) => l.text)).toEqual(["Updated: email check", "Added to the sheet"]);
  });
});

describe("Add PI from an award", () => {
  const award: Award = {
    source: "NSF",
    id: "2443387",
    title: "CAREER: Human-LLM Coordination",
    pi: "Ge Gao",
    university: "University of Maryland",
    amount: 591098,
    currency: "USD",
    url: "https://www.nsf.gov/awardsearch/showAward?AWD_ID=2443387",
    starts: "2025-08-01",
    ends: "2030-07-31",
    monthsAfterIntake: 34,
    inSheet: false,
    abstract: "",
    fit: 2,
  };

  it("makes a row with the award as their grant and source, or adds it to theirs", () => {
    const made = professorFromAward(null, award);
    expect(made).toMatchObject({
      name: "Ge Gao",
      moneyTier: 2,
      lasts: "2030-07-31",
      sources: [award.url],
      grants: [{ source: "NSF", id: "2443387", usd: 591098, ends: "2030-07-31" }],
    });
    const known = { ...blankProfessor("Ge Gao", "University of Maryland"), fit: 5 };
    const added = professorFromAward(known, award);
    expect(added.fit).toBe(5);
    expect(professorFromAward(added, award).grants).toHaveLength(1);
  });
});
