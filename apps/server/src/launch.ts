// Starting the server outside dev: the desktop app and the `gradcode` command both come here.
// One server per GRADCODE_HOME. Two on the same store would each run the loops and the send
// queue, so a launcher that finds one already running opens it instead of starting another.
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import { z } from "zod";
import { homeDir } from "./db.ts";

/** Asked for first, so the page's origin (and what it keeps in localStorage) stays the same. */
export const PREFERRED_PORT = 4350;

/**
 * A started server: its process, port, and who answers for it. `ownerPid` is the app or terminal
 * that stops it on exit; null for `gradcode serve`, which runs until `gradcode stop`.
 */
const Running = z.object({
  pid: z.number(),
  port: z.number(),
  owner: z.enum(["desktop", "cli"]),
  ownerPid: z.number().nullable(),
});
export type Running = z.infer<typeof Running>;

const runFile = (home: string) => NodePath.join(home, "server.json");

export const urlOf = (r: Pick<Running, "port">) => `http://127.0.0.1:${r.port}`;

export { homeDir };

async function healthy(port: number) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The server a launcher recorded for this home, if its process is up and it answers. */
export async function findRunning(home = homeDir()) {
  try {
    const r = Running.parse(JSON.parse(NodeFS.readFileSync(runFile(home), "utf8")));
    return alive(r.pid) && (await healthy(r.port)) ? r : null;
  } catch {
    return null;
  }
}

/** `preferred` when it's free on loopback, else any free port. */
export function freePort(preferred = PREFERRED_PORT) {
  const listen = (port: number) =>
    new Promise<number | null>((resolve) => {
      const s = NodeNet.createServer();
      s.once("error", () => resolve(null));
      s.listen(port, "127.0.0.1", () => {
        const a = s.address();
        s.close(() => resolve(typeof a === "object" && a ? a.port : null));
      });
    });
  return listen(preferred).then(async (p) => p ?? (await listen(0)) ?? preferred);
}

export type Launch = {
  /** The Node that runs the server: the bundled one, or Electron's with ELECTRON_RUN_AS_NODE. */
  node: string;
  /** The bundled server (server.mjs) and the built web app beside it. */
  entry: string;
  webDir: string;
  owner: Running["owner"];
  env?: Record<string, string | undefined>;
  /** Outlives the launcher (`gradcode serve`). */
  detached?: boolean;
};

/**
 * Starts the server on a free port, logging to GRADCODE_HOME/server.log, and records it in
 * server.json once /api/health answers. Rejects if it exits or stays silent for 30 seconds.
 */
export async function startServer(o: Launch) {
  const home = homeDir({ ...process.env, ...o.env });
  NodeFS.mkdirSync(home, { recursive: true });
  const port = await freePort();
  const log = NodeFS.openSync(NodePath.join(home, "server.log"), "a");
  const child = NodeChild.spawn(o.node, [o.entry], {
    env: { ...process.env, ...o.env, SERVER_PORT: String(port), GRADCODE_WEB_DIR: o.webDir },
    stdio: ["ignore", log, log],
    detached: o.detached ?? false,
  });
  NodeFS.closeSync(log);
  let exited = false;
  child.once("exit", () => (exited = true));
  for (let waited = 0; !(await healthy(port)); waited += 200) {
    if (exited || waited > 30_000) {
      child.kill();
      throw new Error(`gradcode's server didn't start. See ${NodePath.join(home, "server.log")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const running: Running = {
    pid: child.pid ?? 0,
    port,
    owner: o.owner,
    ownerPid: o.detached ? null : process.pid,
  };
  NodeFS.writeFileSync(runFile(home), JSON.stringify(running));
  if (o.detached) child.unref();
  return { ...running, child };
}

/** Whether the app or terminal that answered for this server died (a crash, a kill -9). */
export const orphaned = (r: Running) => r.ownerPid !== null && !alive(r.ownerPid);

/** Takes over an orphaned server, so this process stops it when it exits. */
export function adopt(r: Running, owner: Running["owner"], home = homeDir()) {
  const next: Running = { ...r, owner, ownerPid: process.pid };
  NodeFS.writeFileSync(runFile(home), JSON.stringify(next));
  return next;
}

/** Stops a server this home recorded, by its recorded pid, and forgets it. */
export function stopServer(r: Running, home = homeDir()) {
  try {
    process.kill(r.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  NodeFS.rmSync(runFile(home), { force: true });
}

/** Whether release `a` is newer than `b`, comparing x.y.z; a prerelease or odd tag never is. */
export function newer(a: string, b: string) {
  const parts = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** A repo's releases page; GRADCODE_RELEASE_URL points at a mirror, as it does for install.sh. */
export const releasesUrl = (repo: string) =>
  process.env.GRADCODE_RELEASE_URL ?? `https://github.com/${repo}/releases`;

/** The newest version under a releases URL (its /latest redirects to /tag/v<version>), or null. */
export async function latestRelease(releases: string, timeoutMs = 3000) {
  try {
    const r = await fetch(`${releases}/latest`, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return /\/releases\/tag\/v?([^/?#]+)$/.exec(r.url)?.[1] ?? null;
  } catch {
    return null;
  }
}
