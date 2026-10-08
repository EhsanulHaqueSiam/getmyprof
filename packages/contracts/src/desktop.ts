import { z } from "zod";

/**
 * The desktop app's update, pushed from Electron's main process through the preload bridge
 * (`window.getmyprofDesktop`). `available` waits for a click: with `inPlace` (an unsigned Mac app)
 * it installs the release over the app; without (a .deb) it opens the release.
 */
export const DesktopUpdate = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  z.object({ state: z.literal("available"), version: z.string(), inPlace: z.boolean() }),
  z.object({ state: z.literal("downloading"), version: z.string(), percent: z.number() }),
  z.object({ state: z.literal("ready"), version: z.string() }),
]);
export type DesktopUpdate = z.infer<typeof DesktopUpdate>;

/**
 * The Claude Code binary the agent runs. Release builds fetch it on first run (its license keeps
 * it out of our downloads), so Setup shows how far that got, or why it failed.
 */
export const ClaudeBinary = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready") }),
  z.object({ state: z.literal("downloading"), percent: z.number() }),
  z.object({ state: z.literal("missing"), error: z.string() }),
]);
export type ClaudeBinary = z.infer<typeof ClaudeBinary>;
