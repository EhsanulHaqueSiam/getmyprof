// In-app updates from the public release feed: app-update.yml, which electron-builder writes from
// the publish target in scripts/dist.ts. Checks at launch and every 6 hours.
import type { DesktopUpdate } from "@gradcode/contracts";
import { app, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";
import * as NodeChild from "node:child_process";
import * as NodePath from "node:path";

const { autoUpdater } = electronUpdater;

/**
 * Whether this install can replace itself. An AppImage can; a Mac app only with a Developer ID
 * signature, which Squirrel.Mac requires. Elsewhere (an unsigned Mac app, a .deb or AUR
 * package) an update is a notice whose button opens the release.
 */
function installsInPlace() {
  if (process.platform === "linux") return Boolean(process.env.APPIMAGE);
  if (process.platform !== "darwin") return false;
  const bundle = NodePath.resolve(process.execPath, "../../..");
  const r = NodeChild.spawnSync("codesign", ["-dv", "--verbose=2", bundle], { encoding: "utf8" });
  return (r.stderr ?? "").includes("Authority=Developer ID Application");
}

/** Pushes every change to the window, and answers the page's Restart or Download. */
export function watchUpdates(push: (update: DesktopUpdate) => void, releases: string) {
  let current: DesktopUpdate = { state: "none" };
  const set = (update: DesktopUpdate) => {
    current = update;
    push(update);
  };
  ipcMain.on("update:get", (event) => event.sender.send("update", current));
  ipcMain.on("update:act", () => {
    if (current.state === "ready") autoUpdater.quitAndInstall();
    if (current.state === "available")
      void shell.openExternal(`https://github.com/${releases}/releases/tag/v${current.version}`);
  });
  if (!app.isPackaged) return;

  const inPlace = installsInPlace();
  autoUpdater.autoDownload = inPlace;
  autoUpdater.autoInstallOnAppQuit = inPlace;
  autoUpdater.on("update-available", ({ version }) =>
    set(inPlace ? { state: "downloading", version, percent: 0 } : { state: "available", version }),
  );
  autoUpdater.on("download-progress", ({ percent }) => {
    if (current.state === "downloading") set({ ...current, percent });
  });
  autoUpdater.on("update-downloaded", ({ version }) => set({ state: "ready", version }));
  autoUpdater.on("error", (error) => console.error(`update check: ${error.message}`));
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}
