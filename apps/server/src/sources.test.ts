import { describe, expect, it } from "vite-plus/test";
import { sameSchool, sourcesFor } from "./sources.ts";

describe("grant databases", () => {
  it("follow the hunt's places, defaulting to NSF and NIH", () => {
    expect(sourcesFor(["UK", "Germany"])).toEqual(["UKRI", "CORDIS"]);
    expect(sourcesFor(["USA", "Australia"])).toEqual(["NSF", "NIH", "ARC"]);
    expect(sourcesFor([])).toEqual(["NSF", "NIH"]);
    expect(sourcesFor(["Canada"])).toEqual(["NSF", "NIH"]);
  });

  it("match a school however each database spells it", () => {
    expect(sameSchool("UNIVERSITY OF READING", "University of Reading")).toBe(true);
    expect(sameSchool("The University of Melbourne", "Monash University")).toBe(false);
  });
});
