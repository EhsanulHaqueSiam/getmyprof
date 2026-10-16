// Money on the wire: grant awards from the free databases, and advertised PhD positions.
import { z } from "zod";

/**
 * Free grant databases: NSF and NIH (US), UKRI (UK), CORDIS (EU, ERC), ARC (Australia), DFG
 * (Germany), NSERC (Canada), NWO (Netherlands), research.fi (Finland), RAD-on (Poland), ETIS
 * (Estonia), FWF (Austria), the national files of Ireland, Norway (RCN), Chile (ANID) and France (ANR), and
 * OpenAlex's award index for every other funder (JSPS, SNSF, DoD...). All but CORDIS name the PI.
 */
export const AwardSource = z.enum([
  "NSF",
  "NIH",
  "UKRI",
  "CORDIS",
  "ARC",
  "DFG",
  "NSERC",
  "OpenAlex",
  "NWO",
  "RESEARCHFI",
  "RADON",
  "IRELAND",
  "RCN",
  "ANID",
  "ETIS",
  "ANR",
  "FWF",
]);
export type AwardSource = z.infer<typeof AwardSource>;

export const Award = z.object({
  source: AwardSource,
  /** The funder, when the source spans many (OpenAlex): "Japan Society for the Promotion of Science". */
  funder: z.string().optional(),
  id: z.string(),
  title: z.string(),
  /** Empty when the database doesn't name one (CORDIS lists the host, not the PI). */
  pi: z.string(),
  /** The PI's email when the database lists it (NSF does), from the award record itself. */
  piEmail: z.string().optional(),
  /** Co-PIs at the same school, with the email the award lists (NSF): funded faculty too. */
  coPis: z.array(z.object({ name: z.string(), email: z.string() })).optional(),
  university: z.string(),
  amount: z.number().nullable(),
  /** ISO 4217: USD, GBP, EUR, AUD, PLN, JPY, CHF... */
  currency: z.string(),
  /** The award's own page. */
  url: z.string(),
  starts: z.string().nullable(),
  ends: z.string().nullable(),
  /** Whole months the award still runs after the intake starts. Negative: ends before. */
  monthsAfterIntake: z.number().nullable(),
  inSheet: z.boolean(),
  abstract: z.string(),
  /** How many of the hunt's fields its title and abstract name; 0 is off topic. */
  fit: z.number().default(0),
});
export type Award = z.infer<typeof Award>;

/**
 * Boards that post funded PhD positions and answer a plain fetch: jobs.ac.uk (UK), INSPIRE
 * (physics), DAAD (Germany), AcademicTransfer (Netherlands), MUR (Italy's doctorate calls).
 */
export const PositionSource = z.enum(["jobs.ac.uk", "INSPIRE", "DAAD", "AcademicTransfer", "MUR"]);
export type PositionSource = z.infer<typeof PositionSource>;

/** An advertised PhD position. A posted, funded opening is money tier 1 for the professor it names. */
export const Position = z.object({
  source: PositionSource,
  id: z.string(),
  title: z.string(),
  /** The professor or contact the posting names; empty when it names none. */
  professor: z.string(),
  university: z.string(),
  country: z.string(),
  /** The funding line in the posting's words, e.g. "fully funded, EPSRC stipend", "TV-L E13 50%"; empty when unstated. */
  funding: z.string(),
  /** How it pays: a salaried contract (most of Europe) or a scholarship stipend; unknown when the post does not say. */
  kind: z.enum(["employment", "scholarship", "unknown"]).default("unknown"),
  deadline: z.string().nullable(),
  posted: z.string().nullable(),
  /** The posting's own page. */
  url: z.string(),
  abstract: z.string(),
  /** Days until the deadline; negative once closed; null without a deadline. */
  daysLeft: z.number().nullable(),
  inSheet: z.boolean(),
  /** How many of the hunt's fields its title and text name; 0 is off topic. */
  fit: z.number().default(0),
});
export type Position = z.infer<typeof Position>;
