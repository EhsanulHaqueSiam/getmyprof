import { CHECKS, Health } from "@gradcode/contracts";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { health } from "./health.ts";

const tempDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gradcode-health-"));

describe("health", () => {
  it("finds tools on PATH and scout.py under GRADHUNT_DIR", () => {
    const bin = tempDir();
    const gradhunt = tempDir();
    for (const name of ["claude", "treg"]) NodeFS.writeFileSync(NodePath.join(bin, name), "");
    NodeFS.writeFileSync(NodePath.join(gradhunt, "scout.py"), "");

    const result = Health.parse(health({ PATH: bin, GRADHUNT_DIR: gradhunt }));
    expect(result.checks).toEqual({ claude: true, scout: true, treg: true });
  });

  it("reports every check as missing on an empty machine", () => {
    const result = health({ PATH: "", GRADHUNT_DIR: tempDir() });
    expect(Object.keys(result.checks).toSorted()).toEqual([...CHECKS].toSorted());
    expect(Object.values(result.checks).every((found) => !found)).toBe(true);
  });
});
