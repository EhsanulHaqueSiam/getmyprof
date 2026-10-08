import { CHECKS, Health } from "@gradcode/contracts";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { claudeLogin, health } from "./health.ts";

const tempDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gradcode-health-"));

describe("health", () => {
  it("finds tools on PATH and scout.py under GRADHUNT_DIR", () => {
    const bin = tempDir();
    const gradhunt = tempDir();
    for (const name of ["claude", "treg"]) NodeFS.writeFileSync(NodePath.join(bin, name), "");
    NodeFS.writeFileSync(NodePath.join(gradhunt, "scout.py"), "");

    const result = Health.parse(health({ PATH: bin, GRADHUNT_DIR: gradhunt }));
    expect(result.checks).toEqual({ claude: true, scout: true, treg: true });
    // Only the scripted agent says it's safe for e2e.
    expect(result.scripted).toBe(false);
    expect(health({ PATH: "", GRADHUNT_DIR: gradhunt, GRADCODE_AGENT: "fake" }).scripted).toBe(
      true,
    );
  });

  it("reports every check as missing on an empty machine", () => {
    const result = health({ PATH: "", GRADHUNT_DIR: tempDir() }, () => null);
    expect(Object.keys(result.checks).toSorted()).toEqual([...CHECKS].toSorted());
    expect(Object.values(result.checks).every((found) => !found)).toBe(true);
  });
});

describe("the agent's login", () => {
  it("is an API key, or the account `claude` keeps in its config file", () => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-login-"));
    expect(claudeLogin({}, home)).toEqual({ signedIn: false, who: "" });
    NodeFS.writeFileSync(
      NodePath.join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "ada@example.com" } }),
    );
    expect(claudeLogin({}, home)).toEqual({ signedIn: true, who: "ada@example.com" });
    expect(claudeLogin({ ANTHROPIC_API_KEY: "sk-test" }, "/nowhere").signedIn).toBe(true);
  });
});
