import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { adopt, findRunning, newer, orphaned } from "./launch.ts";

const tempHome = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-launch-"));
// No process has this pid on a test machine.
const GONE = 2 ** 22 + 7;

describe("launching outside dev", () => {
  it("compares release versions by number", () => {
    expect(newer("0.10.0", "0.9.3")).toBe(true);
    expect(newer("1.0.0", "1.0.0")).toBe(false);
    expect(newer("0.9.9", "0.10.0")).toBe(false);
    expect(newer("2.0.0-beta.1", "1.0.0")).toBe(false);
  });

  it("starts a new server when the recorded one is gone", async () => {
    const home = tempHome();
    expect(await findRunning(home)).toBeNull();
    NodeFS.writeFileSync(
      NodePath.join(home, "server.json"),
      JSON.stringify({ pid: GONE, port: 9, owner: "cli", ownerPid: null }),
    );
    expect(await findRunning(home)).toBeNull();
  });

  it("lets the next launch adopt a server whose app crashed", async () => {
    const health = NodeHttp.createServer((_, res) => res.end("{}"));
    await new Promise<void>((resolve) => health.listen(0, "127.0.0.1", resolve));
    const address = health.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const home = tempHome();
    NodeFS.writeFileSync(
      NodePath.join(home, "server.json"),
      JSON.stringify({ pid: process.pid, port, owner: "desktop", ownerPid: GONE }),
    );
    const running = await findRunning(home);
    expect(running && orphaned(running)).toBe(true);
    const mine = adopt(running!, "desktop", home);
    expect(orphaned(mine)).toBe(false);
    expect(await findRunning(home)).toEqual(mine);
    health.close();
  });
});
