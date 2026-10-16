import { describe, expect, it } from "vite-plus/test";
import { COUNTRIES } from "./countries.ts";
import { placeCountries } from "./places.ts";

describe("placeCountries", () => {
  it("has one row per code, and lower-case aliases", () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) for (const a of c.aliases ?? []) expect(a).toBe(a.toLowerCase());
  });

  it("reads names, aliases and accents as codes, whole words only", () => {
    expect(placeCountries(["UK"])).toEqual(["gb"]);
    expect(placeCountries(["United Kingdom"])).toEqual(["gb"]);
    expect(placeCountries(["Türkiye", "Hong Kong"])).toEqual(["tr", "hk"]);
    expect(placeCountries(["Russia status"])).toEqual(["ru"]);
    expect(placeCountries(["Dhaka"])).toEqual([]);
  });

  it("reads the longest words first, so a place inside another stays out", () => {
    expect(placeCountries(["New Mexico, USA"])).toEqual(["us"]);
    expect(placeCountries(["Latin America"])).not.toContain("us");
    expect(placeCountries(["Sydney, New South Wales"])).toEqual(["au"]);
    expect(placeCountries(["Belfast, Northern Ireland"])).toEqual(["gb"]);
  });

  it("expands bloc words, unless asked for named countries only", () => {
    expect(placeCountries(["Nordics"]).toSorted()).toEqual(["dk", "fi", "is", "no", "se"]);
    expect(placeCountries(["Europe"])).toContain("gb");
    expect(placeCountries(["EU"])).not.toContain("ch");
    expect(placeCountries(["Europe", "Japan"], false)).toEqual(["jp"]);
  });
});
