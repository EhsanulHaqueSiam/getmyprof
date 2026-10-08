#!/usr/bin/env node
// The `gradcode` command, from install.sh's tarball (with its own Node) or from npm. It runs the
// bundled server (server.mjs) and the built web app (web/) that ship beside it; the release
// build writes the version and the public releases repo into the package.json there.
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { z } from "zod";
import { homeDir } from "./db.ts";
import {
  findRunning,
  latestRelease,
  newer,
  type Running,
  startServer,
  stopServer,
  urlOf,
} from "./launch.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const Pkg = z.object({ version: z.string(), gradcode: z.object({ releases: z.string() }) });
const pkg = Pkg.parse(JSON.parse(NodeFS.readFileSync(NodePath.join(here, "package.json"), "utf8")));
const repo = pkg.gradcode.releases;
// The tarball puts its Node beside cli.mjs; an npm install runs on the user's own Node.
const bundledNode = NodePath.dirname(process.execPath) === here;

const HELP = `gradcode ${pkg.version}: find professors who can fund your degree

  gradcode           start it and open it in your browser (Ctrl-C stops it)
  gradcode serve     keep it running in the background
  gradcode stop      stop the background server
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
  const latest = await latestRelease(repo);
  if (latest && newer(latest, pkg.version))
    console.log(`gradcode ${latest} is out (you have ${pkg.version}). Run: gradcode update`);
}

const already = (r: Running) =>
  console.log(
    `gradcode is already running at ${urlOf(r)}${r.owner === "desktop" ? " (the desktop app)" : ""}`,
  );

async function start() {
  void tellIfOutdated();
  const running = await findRunning();
  if (running) {
    already(running);
    openBrowser(urlOf(running));
    return;
  }
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
  const server = await launch(true);
  console.log(`gradcode on ${urlOf(server)} · gradcode stop stops it`);
  await tellIfOutdated();
}

async function stop() {
  const running = await findRunning();
  if (!running) return console.log("gradcode isn't running.");
  if (running.owner === "desktop") return console.log("The desktop app runs it; quit the app.");
  stopServer(running);
  console.log("Stopped.");
}

function update() {
  if (!bundledNode) {
    console.log("Installed with npm: run npm install -g gradcode@latest");
    return;
  }
  const script = `https://raw.githubusercontent.com/${repo}/main/install.sh`;
  const r = NodeChild.spawnSync("sh", ["-c", `curl -fsSL ${script} | sh`], { stdio: "inherit" });
  if (r.status === 0) console.log("A background server keeps the old version until: gradcode stop");
  process.exitCode = r.status ?? 1;
}

const commands: Record<string, () => unknown> = {
  serve,
  stop,
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
