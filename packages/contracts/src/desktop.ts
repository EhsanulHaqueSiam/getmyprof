import { z } from "zod";

/**
 * The desktop app's update, pushed from Electron's main process through the preload bridge
 * (`window.gradcodeDesktop`). `available` is a notice: this install can't replace itself (an
 * unsigned Mac app, a .deb or AUR package), so its action opens the release to download.
 */
export const DesktopUpdate = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  z.object({ state: z.literal("available"), version: z.string() }),
  z.object({ state: z.literal("downloading"), version: z.string(), percent: z.number() }),
  z.object({ state: z.literal("ready"), version: z.string() }),
]);
export type DesktopUpdate = z.infer<typeof DesktopUpdate>;
