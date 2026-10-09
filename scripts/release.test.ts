import { describe, expect, it } from "vite-plus/test";
import { nextVersion } from "./release.ts";

describe("the next version", () => {
  it("bumps by word, takes a higher X.Y.Z, and refuses anything else", () => {
    expect(nextVersion("0.1.2", "patch")).toBe("0.1.3");
    expect(nextVersion("0.1.2", "minor")).toBe("0.2.0");
    expect(nextVersion("0.1.2", "major")).toBe("1.0.0");
    expect(nextVersion("0.1.2", "0.10.0")).toBe("0.10.0");
    expect(() => nextVersion("0.1.2", "0.1.2")).toThrow("isn't higher");
    expect(() => nextVersion("0.1.2", "0.0.9")).toThrow("isn't higher");
    expect(() => nextVersion("0.1.2", "v0.2.0")).toThrow("Not a version");
  });
});
