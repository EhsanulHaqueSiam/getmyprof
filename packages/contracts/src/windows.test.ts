import { describe, expect, it } from "vite-plus/test";
import { WINDOWS, windowsFor } from "./windows.ts";

describe("windowsFor", () => {
  it("dates Eiffel at the host's call in the autumn before the intake", () => {
    expect(windowsFor(["France"], "Fall 2027").map((w) => w.date)).toEqual(["2026-11-02"]);
  });

  it("has no window where a national scholarship closed", () => {
    expect(windowsFor(["Ireland", "Sweden"], "Fall 2027")).toEqual([]);
  });

  it("dates Asian scholarships for the autumn before, and an embassy's call says to ask it", () => {
    expect(windowsFor(["Hong Kong", "Singapore"], "Fall 2027").map((w) => w.date)).toEqual([
      "2026-12-01",
      "2026-12-31",
    ]);
    const [mext] = windowsFor(["Japan"], "Fall 2027");
    expect(mext?.date).toBe("2026-05-31");
    expect(mext?.detail).toContain("Ask the embassy");
  });

  it("gives every window of a country its own day", () => {
    const ids = WINDOWS.map((w) => `${w.country}-${w.closes}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
