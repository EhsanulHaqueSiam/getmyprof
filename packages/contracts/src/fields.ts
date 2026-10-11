// Which professor fields each detail level fills and shows, and the related fields a hunt could
// add for better odds. The prompt, the Results grid and Setup read them from here.
import { z } from "zod";
import type { DetailLevel, Professor } from "./domain.ts";

export const DETAIL_RANK: Record<DetailLevel, number> = { brief: 0, std: 1, deep: 2 };

/** A field next to the hunt's, with the money at the applicant's schools (hunt.betterOdds). */
export const BetterOdds = z.object({
  field: z.string(),
  /** PIs with NSF or NIH money past the intake, citizen-only training grants left out. */
  fundedPis: z.number(),
  usd: z.number(),
  /** NIH T32 and similar training grants: they pay US citizens and permanent residents only. */
  citizenOnly: z.number(),
});
export type BetterOdds = z.infer<typeof BetterOdds>;

/**
 * The detail level each professor field comes in at: the agent fills it from that level up and the
 * Results grid shows its column from there, so the two never disagree.
 */
export const FIELD_LEVEL = {
  fit: "brief",
  name: "brief",
  moneyTier: "brief",
  taking: "brief",
  money: "brief",
  emailCheck: "brief",
  niche: "std",
  seeking: "std",
  lasts: "std",
  eligibility: "std",
  contact: "std",
  stage: "std",
  recent: "deep",
  scholar: "deep",
  hook: "deep",
  fitsBecause: "deep",
  sources: "deep",
} as const satisfies Partial<Record<keyof Professor, DetailLevel>>;

/** The fields the agent fills at a detail level, beyond the name it always gives. */
export const fieldsAt = (level: DetailLevel) =>
  Object.entries(FIELD_LEVEL)
    .filter(([f, l]) => f !== "name" && f !== "sources" && DETAIL_RANK[l] <= DETAIL_RANK[level])
    .map(([f]) => f);
