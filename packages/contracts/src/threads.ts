// Threads and the events a thread's view renders. The server appends events; the client keys
// them by id, so a later event with the same id replaces the earlier one (a tool call that
// finishes, an approval that resolves).
import { z } from "zod";

export const ThreadStatus = z.enum(["idle", "working", "approval", "input", "failed"]);
export type ThreadStatus = z.infer<typeof ThreadStatus>;

export const ThreadSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: ThreadStatus,
  unread: z.boolean(),
  settledAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  workingSince: z.string().nullable(),
  updatedAt: z.string(),
  spendUsd: z.number(),
  /** Spend in the last 24 hours, the window the day cap counts. */
  spendDayUsd: z.number(),
  loopId: z.string().nullable(),
  pendingReview: z.number(),
  rows: z.number(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

const base = { id: z.string(), at: z.string() };

export const ThreadEvent = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("user"),
    text: z.string(),
    /** queued: waits for the next tool call; steered: sent mid-turn. */
    delivery: z.enum(["send", "queued", "steered"]),
    /** Names of files attached from the vault. */
    attachments: z.array(z.string()).default([]),
  }),
  z.object({ ...base, type: z.literal("assistant"), text: z.string() }),
  z.object({
    ...base,
    type: z.literal("tool"),
    name: z.string(),
    detail: z.string(),
    status: z.enum(["running", "done", "error", "denied"]),
    meta: z.string(),
    costUsd: z.number(),
  }),
  z.object({
    ...base,
    type: z.literal("approval"),
    title: z.string(),
    body: z.string(),
    why: z.string(),
    costUsd: z.number(),
    status: z.enum(["pending", "allowed", "denied"]),
  }),
  z.object({
    ...base,
    type: z.literal("turn"),
    durationMs: z.number(),
    calls: z.number(),
    costUsd: z.number(),
  }),
  z.object({ ...base, type: z.literal("system"), text: z.string() }),
  /** The agent asked the applicant something only they know; the thread waits for the answer. */
  z.object({
    ...base,
    type: z.literal("question"),
    text: z.string(),
    status: z.enum(["pending", "answered"]),
  }),
]);
export type ThreadEvent = z.infer<typeof ThreadEvent>;

/**
 * Row actions the Results dock runs on selected rows. Each is an agent turn. `priceUsd` is the
 * usual cost a row with paid lookups on: finding an address no official page lists.
 */
export const ROW_OPS = {
  email: { label: "Find and check emails", priceUsd: 0.0048, field: "emailCheck" },
  lasts: { label: "Check money (NSF, NIH)", priceUsd: 0, field: "lasts" },
  taking: { label: "Taking students?", priceUsd: 0, field: "taking" },
  draft: { label: "Draft first emails", priceUsd: 0, field: "stage" },
} as const;
export const RowOp = z.enum(["email", "lasts", "taking", "draft"]);
export type RowOp = z.infer<typeof RowOp>;
