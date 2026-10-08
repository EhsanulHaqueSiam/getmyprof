// getmyprof's desktop app: Electron's main process. It starts the bundled server (runtime/server.mjs)
// on Electron's own Node, opens a window on the web app it serves, and stops the server on quit.
// Data stays in ~/.getmyprof (GETMYPROF_HOME moves it), the same store the `getmyprof` command uses.
import {
  adopt,
  findRunning,
  homeDir,
  orphaned,
  type Running,
  startServer,
  stopServer,
  urlOf,
} from "@getmyprof/server/launch";
import { app, BrowserWindow, dialog, shell } from "electron";
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { z } from "zod";
import { watchUpdates } from "./updates.ts";

// Electron's profile and its one-instance lock live with the data, so a test run on a temp
// GETMYPROF_HOME never shares (or waits on) a real install's.
app.setPath("userData", NodePath.join(homeDir(), "desktop"));

// Packaged, the runtime sits in Resources; from a checkout, `pnpm dist runtime` stages it here.
const runtime = app.isPackaged
  ? NodePath.join(process.resourcesPath, "runtime")
  : NodePath.join(app.getAppPath(), "dist", "runtime");

/** The public releases repo (owner/name), written by `pnpm dist runtime`. */
const release = z
  .object({ getmyprof: z.object({ releases: z.string() }) })
  .parse(JSON.parse(NodeFS.readFileSync(NodePath.join(runtime, "package.json"), "utf8")));

let window: BrowserWindow | null = null;
let appUrl: string | null = null;
/** The server this app started, which it stops on quit. Null when it opened one already running. */
let ours: Running | null = null;

/**
 * A Mac or Linux app opened from the dock or a launcher gets a bare PATH. The login shell's
 * PATH lets the server find what the user installed (npx for MCP servers, tailscale, claude).
 */
function loginPath() {
  try {
    const out = NodeChild.execFileSync(
      process.env.SHELL ?? "/bin/sh",
      ["-ilc", 'printf "<path>%s</path>" "$PATH"'],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return /<path>(.*)<\/path>/.exec(out)?.[1] ?? process.env.PATH;
  } catch {
    return process.env.PATH;
  }
}

/** Off-origin links and sign-ins go to the user's browser; the app's own pages stay here. */
function external(url: string) {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

const sameOrigin = (url: string, origin: string) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

function openWindow(url: string) {
  const origin = new URL(url).origin;
  window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: "getmyprof",
    backgroundColor: "#000000",
    // Linux: the menu bar shows on Alt; the app's own UI is the menu.
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: NodePath.join(import.meta.dirname, "preload.cjs"), sandbox: true },
  });
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => (window = null));
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (sameOrigin(target, origin)) return { action: "allow" };
    external(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (sameOrigin(target, origin)) return;
    event.preventDefault();
    external(target);
  });
  void window.loadURL(url);
}

async function boot() {
  const running = await findRunning();
  // A server left by a crashed app is this one's now: it stops it on quit.
  if (running && orphaned(running)) ours = adopt(running, "desktop");
  const server =
    running ??
    (await startServer({
      node: process.execPath,
      entry: NodePath.join(runtime, "server.mjs"),
      webDir: NodePath.join(runtime, "web"),
      owner: "desktop",
      env: { ELECTRON_RUN_AS_NODE: "1", ...(app.isPackaged ? { PATH: loginPath() } : {}) },
    }));
  if (!running) ours = server;
  appUrl = urlOf(server);
  openWindow(appUrl);
  watchUpdates((update) => window?.webContents.send("update", update), release.getmyprof.releases);
}

/** Brings the window back: a second launch or a dock click, also after it was closed on a Mac. */
function reopen() {
  if (!window && appUrl) return openWindow(appUrl);
  if (window?.isMinimized()) window.restore();
  window?.focus();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", reopen);
  app.on("activate", reopen);
  // On a Mac the app (and its loops) keep running with the window closed, like any Mac app.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    if (ours) stopServer(ours);
  });
  app
    .whenReady()
    .then(boot)
    .catch((error: unknown) => {
      dialog.showErrorBox(
        "getmyprof couldn't start",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
}
