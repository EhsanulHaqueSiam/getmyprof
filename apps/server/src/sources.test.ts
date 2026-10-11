import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { sameSchoolName } from "@getmyprof/contracts";
import { openAlexMatch, sameSchool, sourcesFor } from "./sources.ts";

describe("grant databases", () => {
  it("follow the hunt's places, defaulting to NSF and NIH", () => {
    expect(sourcesFor(["UK", "Germany"])).toEqual(["UKRI", "CORDIS", "DFG"]);
    expect(sourcesFor(["USA", "Australia"])).toEqual(["NSF", "NIH", "ARC"]);
    expect(sourcesFor([])).toEqual(["NSF", "NIH"]);
    expect(sourcesFor(["Canada"])).toEqual(["NSERC"]);
    expect(sourcesFor(["India"])).toEqual([]);
  });

  it("match a school however each database spells it", () => {
    expect(sameSchool("UNIVERSITY OF READING", "University of Reading")).toBe(true);
    expect(sameSchool("The University of Melbourne", "Monash University")).toBe(false);
    expect(sameSchoolName("Univ. of Utah", "University of Utah")).toBe(true);
    expect(sameSchoolName("Utah State University", "University of Utah")).toBe(false);
  });
});

describe("which OpenAlex author a professor is", () => {
  afterEach(() => vi.restoreAllMocks());
  const authors = (...schools: string[]) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        results: schools.map((s, i) => ({
          id: `A${i}`,
          last_known_institutions: [{ display_name: s }],
        })),
      }),
    );

  it("takes the one at that very school, not the first that shares a word", async () => {
    authors("University of Illinois Chicago", "University of Chicago");
    // Each call asks for someone else: OpenAlex answers are kept for a day by URL.
    expect((await openAlexMatch("Ada Smith", "University of Chicago"))?.id).toBe("A1");
    // "University" alone is no match: Stanford isn't the University of Illinois Chicago.
    authors("Stanford University");
    expect(await openAlexMatch("Bo Smith", "University of Illinois Chicago")).toBeNull();
    authors("Stanford University", "University of Illinois Chicago");
    expect((await openAlexMatch("Cy Smith", "University of Illinois Chicago"))?.id).toBe("A1");
  });
});
