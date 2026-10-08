import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { findRunning, newer } from "./launch.ts";

describe("launching outside dev", () => {
  it("compares release versions by number", () => {
    expect(newer("0.10.0", "0.9.3")).toBe(true);
    expect(newer("1.0.0", "1.0.0")).toBe(false);
    expect(newer("0.9.9", "0.10.0")).toBe(false);
    expect(newer("2.0.0-beta.1", "1.0.0")).toBe(false);
  });

  it("starts a new server when the recorded one is gone", async () => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-launch-"));
    expect(await findRunning(home)).toBeNull();
    // A server.json left by a crash: its process is gone, so nothing answers.
    const gone = 2 ** 22 + 7;
    NodeFS.writeFileSync(
      NodePath.join(home, "server.json"),
      JSON.stringify({ pid: gone, port: 9, owner: "cli" }),
    );
    expect(await findRunning(home)).toBeNull();
  });
});
