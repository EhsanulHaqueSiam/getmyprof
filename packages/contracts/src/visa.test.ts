import { describe, expect, it } from "vite-plus/test";
import { laneFor, laneLine } from "./visa.ts";

describe("laneFor", () => {
  it("finds a country however a program names it", () => {
    expect(laneFor("Canada")?.stayAfterMonths).toBe(36);
    expect(laneFor("Ontario, Canada")?.stayAfterMonths).toBe(36);
    expect(laneFor("Republic of Korea")?.permit).toMatch(/^D-2/);
    expect(laneFor("Germany")?.recognition).toBe("anabin");
    expect(laneFor("Europe")).toBeNull();
    expect(laneFor("")).toBeNull();
  });

  it("says Schengen, EU or neither, and when the permit ends with the degree", () => {
    const line = (country: string) => {
      const lane = laneFor(country);
      return lane ? laneLine(lane) : "";
    };
    expect(line("Netherlands")).toBe(
      "Schengen · hosting agreement (directive 2016/801) · 12 months after to find work",
    );
    expect(line("Ireland")).toMatch(/^EU, not Schengen · /);
    expect(line("Saudi Arabia")).toBe(
      "student residence (iqama); no paid work · the permit ends with the degree",
    );
  });
});
