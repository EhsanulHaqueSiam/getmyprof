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
});
export type Health = z.infer<typeof Health>;

/** Messages the server pushes over /ws. Agent events join this union as they land. */
export const ServerMessage = z.discriminatedUnion("type", [z.object({ type: z.literal("hello") })]);
export type ServerMessage = z.infer<typeof ServerMessage>;
