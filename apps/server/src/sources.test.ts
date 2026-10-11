import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { sameSchoolName } from "@getmyprof/contracts";
import { placeCountries } from "./places.ts";
import { nsfAwards, openAlexMatch, sameSchool, sourcesFor } from "./sources.ts";

describe("grant databases", () => {
  it("follow the hunt's places, defaulting to NSF and NIH", () => {
    expect(sourcesFor(["UK", "Germany"])).toEqual(["UKRI", "CORDIS", "DFG", "OpenAlex"]);
    expect(sourcesFor(["USA", "Australia"])).toEqual(["NSF", "NIH", "ARC", "OpenAlex"]);
    expect(sourcesFor([])).toEqual(["NSF", "NIH"]);
    expect(sourcesFor(["Canada"])).toEqual(["NSERC", "OpenAlex"]);
    // Japan has no direct database; OpenAlex's awards carry JSPS.
    expect(sourcesFor(["Japan"])).toEqual(["OpenAlex"]);
    expect(sourcesFor(["Mars"])).toEqual([]);
    expect(placeCountries(["Japan", "Hong Kong", "UK"])).toEqual(["gb", "jp", "hk"]);
    // Whole words only: "us" isn't in "Russia" or "status".
    expect(placeCountries(["Russia status"])).toEqual([]);
  });

  it("read CORDIS for any European country or bloc word", () => {
    expect(sourcesFor(["Czechia"])).toEqual(["CORDIS"]);
    expect(sourcesFor(["Schengen countries"])).toEqual(["CORDIS"]);
    expect(sourcesFor(["Ireland", "Italy"])).toEqual(["CORDIS", "OpenAlex"]);
    expect(sourcesFor(["Finland", "France"])).toEqual(["CORDIS", "RESEARCHFI", "OpenAlex"]);
    expect(sourcesFor(["Netherlands", "Poland"])).toEqual(["CORDIS", "NWO", "RADON", "OpenAlex"]);
    expect(sourcesFor(["Dhaka"])).toEqual([]);
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

describe("NSF awards", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keep the co-PIs at the PI's own school, with the email the award lists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        response: {
          award: [
            {
              id: "2531369",
              piFirstName: "Hemant",
              piLastName: "Purohit",
              piEmail: "hpurohit@gmu.edu",
              awardeeName: "George Mason University",
              coPDPI: ["Joshua G Behr Jbehr@odu.edu", "Jennifer M Suh jsuh4@gmu.edu"],
            },
          ],
        },
      }),
    );
    const [award] = await nsfAwards({ terms: ["crisis informatics"] });
    expect(award?.piEmail).toBe("hpurohit@gmu.edu");
    expect(award?.coPis).toEqual([{ name: "Jennifer M Suh", email: "jsuh4@gmu.edu" }]);
  });
});
