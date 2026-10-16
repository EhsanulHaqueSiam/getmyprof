import { describe, expect, it } from "vite-plus/test";
import { windowsFor } from "./windows.ts";

describe("windowsFor", () => {
  it("dates Eiffel at the host's call in the autumn before the intake", () => {
    expect(windowsFor(["France"], "Fall 2027").map((w) => w.date)).toEqual(["2026-11-02"]);
  });

  it("has no window where a national scholarship closed", () => {
    expect(windowsFor(["Ireland", "Sweden"], "Fall 2027")).toEqual([]);
  });
});
