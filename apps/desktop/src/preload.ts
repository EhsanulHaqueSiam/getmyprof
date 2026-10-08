// The page's only door into Electron: `window.gradcodeDesktop`, typed and read by
// apps/web/src/components/UpdateBanner.tsx. Bundled to CommonJS; sandboxed preloads can't be ESM.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gradcodeDesktop", {
  /** Calls back with every update state, starting with the current one. Returns an unsubscribe. */
  onUpdate(listener: (update: unknown) => void) {
    const handler = (_event: unknown, update: unknown) => listener(update);
    ipcRenderer.on("update", handler);
    ipcRenderer.send("update:get");
    return () => {
      ipcRenderer.off("update", handler);
    };
  },
  /** Restart into a downloaded update, or open the release when this install can't update itself. */
  act: () => ipcRenderer.send("update:act"),
});
