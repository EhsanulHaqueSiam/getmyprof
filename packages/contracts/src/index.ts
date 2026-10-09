// Everything that crosses the wire between apps/server and apps/web. Change a schema here
// and both sides follow. Decode untrusted input with `.parse` at the edge, never cast.
import { z } from "zod";

/** Local tools the server depends on. GET /api/health reports each one. */
export const CHECKS = ["claude", "scout", "treg"] as const;
export const Check = z.enum(CHECKS);
export type Check = z.infer<typeof Check>;

export const Health = z.object({
  host: z.string(),
  checks: z.record(Check, z.boolean()),
  /** Runs the scripted agent and fake mailbox (GETMYPROF_AGENT=fake): safe for e2e and /verify. */
  scripted: z.boolean(),
});
export type Health = z.infer<typeof Health>;

export * from "./domain.ts";
export * from "./threads.ts";
export * from "./rpc.ts";
export * from "./outreach.ts";
export * from "./vault.ts";
export * from "./deadlines.ts";
export * from "./applying.ts";
export * from "./report.ts";
export * from "./desktop.ts";
