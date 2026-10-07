// The hunt's records: preferences, profile facts, professors, proposals, loops. Shared by the
// server's store and the client's views, so a field added here shows up on both sides.
import { z } from "zod";

export const DetailLevel = z.enum(["brief", "std", "deep"]);
export type DetailLevel = z.infer<typeof DetailLevel>;

export const Degree = z.enum(["phd", "ms_phd", "funded_ms"]);
export type Degree = z.infer<typeof Degree>;
export const Priority = z.enum(["money", "recruiting", "topic", "deadline", "rank"]);

/** What a person is hunting for. Every agent turn and loop reads it. */
export const HuntPrefs = z.object({
  degrees: z.array(Degree),
  intake: z.string(),
  fallbackIntake: z.string(),
  places: z.array(z.string()),
  fields: z.array(z.string()),
  adjacent: z.array(z.string()),
  fundingFloor: z.enum(["full", "tuition"]),
  preferTestWaivers: z.boolean(),
  sweep: z.object({ reach: z.number(), match: z.number(), safety: z.number() }),
  priorities: z.array(Priority),
});
export type HuntPrefs = z.infer<typeof HuntPrefs>;

export const Hunt = z.object({ id: z.string(), name: z.string(), prefs: HuntPrefs });
export type Hunt = z.infer<typeof Hunt>;

export const Budget = z.object({
  perThread: z.number(),
  perLoopRun: z.number(),
  perDay: z.number(),
  /** Paid actions above this ask first. */
  askOver: z.number(),
});
export type Budget = z.infer<typeof Budget>;

export const Settings = z.object({
  detail: DetailLevel,
  budget: Budget,
  model: z.string(),
  /** Paid lookups through the treg CLI. Off means free sources only. */
  treg: z.boolean(),
  profileSource: z.enum(["app", "hq"]),
  /** Siam's install: mirror ~/Personal/gradhunt records and write back through scout.py. */
  gradhunt: z.boolean(),
  setupDone: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;

export const FactKind = z.enum(["education", "paper", "project", "test", "work", "other"]);
export type FactKind = z.infer<typeof FactKind>;

export const ProfileFact = z.object({
  id: z.string(),
  text: z.string(),
  /** Its proof: the document or link it was read from. A fact without one is never written into anything. */
  source: z.string(),
  kind: FactKind.default("other"),
  confirmed: z.boolean(),
  /** A fact the agent couldn't verify becomes a question for the user. */
  question: z.boolean(),
});
export type ProfileFact = z.infer<typeof ProfileFact>;

/** A fact can be written into something only once it's confirmed and has its proof. */
export function factStatus(f: ProfileFact) {
  if (f.question) return "question";
  if (!f.confirmed) return "unconfirmed";
  if (!f.source.trim()) return "needs proof";
  return "confirmed";
}

export const TestStatus = z.enum(["taken", "booked", "planned", "none"]);

/** Who the applicant is, for eligibility: citizenship decides who may pay them and which scholarships exist. */
export const Applicant = z.object({
  citizenship: z.array(z.string()),
  residence: z.string(),
  degreeYears: z.number().int().min(0).max(6),
  gpa: z.string(),
  tests: z.array(
    z.object({ name: z.string(), status: TestStatus, date: z.string(), score: z.string() }),
  ),
  moi: z.boolean(),
  feeBudgetUsd: z.number().nullable(),
  dependents: z.boolean(),
  minStipendUsd: z.number().nullable(),
});
export type Applicant = z.infer<typeof Applicant>;

export const Stage = z.enum(["new", "drafted", "sent", "replied", "apply-only", "skip"]);
export type Stage = z.infer<typeof Stage>;

export const Grant = z.object({
  source: z.string(),
  id: z.string(),
  title: z.string(),
  usd: z.number().nullable(),
  ends: z.string().nullable(),
});
export type Grant = z.infer<typeof Grant>;

/** One professor row. Free-text cells keep the agent's wording; sources back every claim. */
export const Professor = z.object({
  key: z.string(),
  name: z.string(),
  university: z.string(),
  department: z.string(),
  niche: z.string(),
  fit: z.number().int().min(0).max(5),
  /** 1 clear (posted opening), 2 strong (grant or startup), 3 indirect signs, 4 none found, 0 not checked. */
  moneyTier: z.number().int().min(0).max(4).default(0),
  /** "ok", or "no: <why>" when the applicant can't be paid here (citizenship-only funding, degree). */
  eligibility: z.string().default(""),
  taking: z.string(),
  money: z.string(),
  lasts: z.string(),
  email: z.string(),
  emailCheck: z.string(),
  contact: z.string(),
  stage: Stage,
  fitsBecause: z.string(),
  website: z.string(),
  sources: z.array(z.string()),
  grants: z.array(Grant),
  origin: z.enum(["app", "gradhunt"]),
  updatedAt: z.string(),
});
export type Professor = z.infer<typeof Professor>;

/** Fields a proposal may change. key, origin and updatedAt are the store's to manage. */
export const PROFESSOR_FIELDS = [
  "name",
  "university",
  "department",
  "niche",
  "fit",
  "moneyTier",
  "eligibility",
  "taking",
  "money",
  "lasts",
  "email",
  "emailCheck",
  "contact",
  "stage",
  "fitsBecause",
  "website",
] as const;
export type ProfessorField = (typeof PROFESSOR_FIELDS)[number];

export const Change = z.object({
  field: z.enum(PROFESSOR_FIELDS),
  from: z.string().nullable(),
  to: z.string(),
});
export type Change = z.infer<typeof Change>;

export const Proposal = z.object({
  id: z.string(),
  threadId: z.string(),
  recordKey: z.string(),
  recordName: z.string(),
  university: z.string(),
  kind: z.enum(["add", "update"]),
  changes: z.array(Change),
  sources: z.array(z.string()),
  status: z.enum(["pending", "accepted", "rejected"]),
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof Proposal>;

export const Schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), at: z.string() }),
  z.object({ kind: z.literal("weekly"), day: z.number().int().min(0).max(6), at: z.string() }),
  z.object({ kind: z.literal("every"), hours: z.number().positive() }),
]);
export type Schedule = z.infer<typeof Schedule>;

export const Loop = z.object({
  id: z.string(),
  name: z.string(),
  instructions: z.string(),
  schedule: Schedule,
  budgetUsd: z.number(),
  enabled: z.boolean(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastSummary: z.string(),
});
export type Loop = z.infer<typeof Loop>;

export const Award = z.object({
  source: z.enum(["NSF", "NIH"]),
  id: z.string(),
  title: z.string(),
  pi: z.string(),
  university: z.string(),
  usd: z.number().nullable(),
  starts: z.string().nullable(),
  ends: z.string().nullable(),
  /** Whole months the award still runs after the intake starts. Negative: ends before. */
  monthsAfterIntake: z.number().nullable(),
  inSheet: z.boolean(),
  abstract: z.string(),
});
export type Award = z.infer<typeof Award>;
