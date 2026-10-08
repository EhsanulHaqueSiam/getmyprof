#!/usr/bin/env node
// The `gradcode` command, from install.sh's tarball (with its own Node) or from npm. It runs the
// bundled server (server.mjs) and the built web app (web/) that ship beside it; the release
// build writes the version and the public releases repo into the package.json there.
import type { ClaudeBinary } from "@gradcode/contracts";
import * as NodeChild from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { z } from "zod";
import { ensureClaude, findClaude } from "./agent/binary.ts";
import {
  findRunning,
  homeDir,
  latestRelease,
  newer,
  orphaned,
  releasesUrl,
  type Running,
  startServer,
  stopServer,
  urlOf,
} from "./launch.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const Pkg = z.object({ version: z.string(), gradcode: z.object({ releases: z.string() }) });
const pkg = Pkg.parse(JSON.parse(NodeFS.readFileSync(NodePath.join(here, "package.json"), "utf8")));
const releases = releasesUrl(pkg.gradcode.releases);
// The tarball puts its Node beside cli.mjs; an npm install runs on the user's own Node.
const bundledNode = NodePath.dirname(process.execPath) === here;

const HELP = `gradcode ${pkg.version}: find professors who can fund your degree

  gradcode           start it and open it in your browser (Ctrl-C stops it)
  gradcode serve     keep it running in the background
  gradcode stop      stop the background server
  gradcode login     sign in to Claude; your subscription runs the agent
  gradcode update    install the newest release
  gradcode --version

Your data lives in ${homeDir()} (set GRADCODE_HOME to move it).`;

const launch = (detached: boolean) =>
  startServer({
    node: process.execPath,
    entry: NodePath.join(here, "server.mjs"),
    webDir: NodePath.join(here, "web"),
    owner: "cli",
    detached,
  });

function openBrowser(url: string) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  NodeChild.spawn(opener, [url], { stdio: "ignore", detached: true })
    .on("error", () => console.log(`Open ${url} in your browser.`))
    .unref();
}

async function tellIfOutdated() {
  const latest = await latestRelease(releases);
  if (latest && newer(latest, pkg.version))
    console.log(`gradcode ${latest} is out (you have ${pkg.version}). Run: gradcode update`);
}

const already = (r: Running) =>
  console.log(
    `gradcode is already running at ${urlOf(r)}${r.owner === "desktop" && !orphaned(r) ? " (the desktop app)" : ""}`,
  );

/** One line that counts up on a terminal; a few lines when the output is a log. */
function progressLine() {
  let shown = -25;
  return (s: ClaudeBinary) => {
    if (s.state !== "downloading") return;
    if (process.stdout.isTTY) process.stdout.write(`\rDownloading Claude Code · ${s.percent}%`);
    else if (s.percent >= shown + 25)
      console.log(`Downloading Claude Code · ${(shown = s.percent)}%`);
  };
}

/** The first run fetches the agent's binary here, where its progress shows. Offline, it says so. */
async function fetchAgent() {
  if (process.env.GRADCODE_AGENT === "fake" || findClaude()) return;
  try {
    await ensureClaude(progressLine());
    if (process.stdout.isTTY) process.stdout.write("\n");
  } catch (error) {
    if (process.stdout.isTTY) process.stdout.write("\n");
    console.log(
      `${error instanceof Error ? error.message : String(error)} gradcode starts anyway.`,
    );
  }
}

async function start() {
  void tellIfOutdated();
  const running = await findRunning();
  if (running) {
    already(running);
    openBrowser(urlOf(running));
    return;
  }
  await fetchAgent();
  const server = await launch(false);
  console.log(`gradcode on ${urlOf(server)} · Ctrl-C stops it`);
  openBrowser(urlOf(server));
  const end = () => stopServer(server);
  process.once("SIGINT", end).once("SIGTERM", end);
  server.child.once("exit", (code) => {
    end();
    process.exit(code ?? 0);
  });
}

async function serve() {
  const running = await findRunning();
  if (running) return already(running);
  await fetchAgent();
  const server = await launch(true);
  console.log(`gradcode on ${urlOf(server)} · gradcode stop stops it`);
  await tellIfOutdated();
}

async function stop() {
  const running = await findRunning();
  if (!running) return console.log("gradcode isn't running.");
  if (running.owner === "desktop" && !orphaned(running))
    return console.log("The desktop app runs it; quit the app.");
  stopServer(running);
  console.log("Stopped.");
}

/** Claude Code's own sign-in, in this terminal. */
async function login() {
  const binary = await ensureClaude(progressLine());
  if (process.stdout.isTTY) process.stdout.write("\n");
  const r = NodeChild.spawnSync(binary, ["auth", "login"], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
}

/** A release asset, or an error naming the URL and why; never a silent half-download. */
async function asset(version: string, name: string) {
  const url = `${releases}/download/v${version}/${name}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((error: unknown) => {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    throw new Error(`Couldn't download ${url}: ${cause instanceof Error ? cause.message : cause}`);
  });
  if (!r.ok) throw new Error(`Couldn't download ${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Installs the newest release with that release's own install.sh, after checking it against the
 * release's SHA256SUMS. Any failure says what and leaves the installed version in place.
 */
async function update() {
  if (!bundledNode) return console.log("Installed with npm: run npm install -g gradcode@latest");
  const latest = await latestRelease(releases, 10_000);
  if (!latest) throw new Error(`Couldn't reach ${releases}. Check the connection and try again.`);
  if (!newer(latest, pkg.version)) return console.log(`gradcode ${pkg.version} is the newest.`);
  const [sums, script] = await Promise.all([
    asset(latest, "SHA256SUMS"),
    asset(latest, "install.sh"),
  ]);
  const expected = /^([0-9a-f]{64}) {2}install\.sh$/m.exec(sums.toString())?.[1];
  const actual = NodeCrypto.createHash("sha256").update(script).digest("hex");
  if (expected !== actual) throw new Error("install.sh doesn't match the release's SHA256SUMS.");
  const file = NodePath.join(NodeOS.tmpdir(), `gradcode-install-${process.pid}.sh`);
  NodeFS.writeFileSync(file, script);
  const r = NodeChild.spawnSync("sh", [file], {
    stdio: "inherit",
    env: { ...process.env, GRADCODE_VERSION: latest },
  });
  NodeFS.rmSync(file, { force: true });
  if (r.status !== 0) throw new Error(`The update didn't install; gradcode ${pkg.version} stays.`);
  if (await findRunning())
    console.log("The running server keeps the old version until: gradcode stop");
}

const commands: Record<string, () => unknown> = {
  serve,
  stop,
  login,
  update,
  "--version": () => console.log(pkg.version),
  "--help": () => console.log(HELP),
};
const arg = process.argv[2];
const unknown = () => {
  console.log(HELP);
  process.exitCode = 1;
};
const run = arg === undefined ? start : (commands[arg] ?? unknown);
try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
