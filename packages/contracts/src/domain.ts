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
  /** Business days after the first email that follow-ups 1 and 2 go out. */
  followUpDays: z.tuple([z.number().int().min(1), z.number().int().min(1)]).default([7, 14]),
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

/** An MCP server the user adds; every agent session gets its tools. Untrusted ones ask first. */
export const McpServer = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("http"),
    name: z.string().regex(/^[a-z0-9_-]+$/i),
    url: z.string(),
    trusted: z.boolean(),
  }),
  z.object({
    transport: z.literal("stdio"),
    name: z.string().regex(/^[a-z0-9_-]+$/i),
    command: z.string(),
    args: z.array(z.string()),
    trusted: z.boolean(),
  }),
]);
export type McpServer = z.infer<typeof McpServer>;

/** A treg tag value: letters, digits and . _ - : only, so it can't be an email address. */
export const TagValue = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/, "letters, digits and . _ - : only");

/** A treg token pinned to one customer, as scripts/treg-admin.ts prints it. */
export const TregConnect = z.object({ customer: TagValue, token: z.string().min(8) });
export type TregConnect = z.infer<typeof TregConnect>;

/** Paid lookups on this install: who they bill and what they cost this month. */
export const TregStatus = z.object({
  connected: z.boolean(),
  customer: z.string(),
  month: z.object({
    usd: z.number(),
    calls: z.number(),
    byFeature: z.array(z.object({ feature: z.string(), usd: z.number(), calls: z.number() })),
  }),
});
export type TregStatus = z.infer<typeof TregStatus>;

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
  // No .default() here: a partial update would fill it in and wipe the saved value.
  // getSettings fills missing keys from DEFAULT_SETTINGS instead.
  mcpServers: z.array(McpServer),
  /** Bearer token other agents use to reach gradcode's own MCP endpoint, /api/mcp. */
  mcpToken: z.string(),
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
  /** When it happened, as precise as the source says: "2025", "2025-05" or "2025-05-14". Empty when undated. */
  date: z.string().default(""),
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

const SCORE = /\b(IELTS|TOEFL|GRE|PTE|Duolingo)\b[^.\n]{0,24}?\b\d{1,3}(\.\d)?\b/i;

/** A test score in the text with no taken test behind it. Blocks export, sending and approving. */
export const unbackedScore = (text: string, applicant: Pick<Applicant, "tests"> | undefined) =>
  SCORE.test(text) && !applicant?.tests.some((t) => t.status === "taken" && t.score.trim());

// First-person sentences that claim something the applicant did, earned or holds.
const CLAIM =
  /\b(?:I|I've|we|we've)\b[^.!?\n]*?\b(?:led|built|published|wrote|won|received|completed|graduated|worked|developed|designed|authored|co-authored|presented|earned|scored|achieved|managed|taught|interned|researched|implemented|trained|deployed|founded|ranked|joined|created|contributed|collaborated|conducted|analy[sz]ed|served|mentored|supervised|organi[sz]ed|launched|studied|hold|placed|finished)\b/i;
const MY_CLAIM =
  /\bmy (?:GPA|CGPA|grades?|score|IELTS|TOEFL|GRE|GMAT|rank|award|scholarship|paper|publication|thesis|degree|internship)\b/i;

/**
 * Sentences that claim something about the applicant ("I led a team of five", "my CGPA is 3.7")
 * and cite no fact with an [n] marker. Such a claim blocks export, approving and sending.
 */
export const uncitedClaims = (text: string) =>
  text
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !/\[\d+\]/.test(s) && (CLAIM.test(s) || MY_CLAIM.test(s)));

/** The text as it leaves the app: [n] citation markers gone. */
export const stripCitations = (text: string) => text.replace(/[ \t]*\[\d+\]/g, "");

/** Whether an address passed a check: printed on an official page, or verified deliverable. */
export const addressChecked = (emailCheck: string) =>
  /^(ok|valid|deliverable|verified)\b|official page/i.test(emailCheck.trim()) &&
  !/invalid|undeliverable|bounce|risky/i.test(emailCheck);

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

/**
 * When a loop runs: every N hours, at a time on chosen weekdays (0 Sunday; none means every
 * day), or when its webhook is called. daily and weekly are older forms, still read.
 */
export const Schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("every"), hours: z.number().positive() }),
  z.object({
    kind: z.literal("at"),
    at: z.string(),
    weekdays: z.array(z.number().int().min(0).max(6)),
  }),
  z.object({ kind: z.literal("webhook") }),
  z.object({ kind: z.literal("daily"), at: z.string() }),
  z.object({ kind: z.literal("weekly"), day: z.number().int().min(0).max(6), at: z.string() }),
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
  /** Each run in a fresh thread, or every run back in one thread. */
  reportTo: z.enum(["fresh", "same"]).default("fresh"),
  /** The one thread runs go to when reportTo is "same". */
  threadId: z.string().nullable().default(null),
  /** The secret in a webhook loop's URL, /api/hooks/<token>. */
  hookToken: z.string().nullable().default(null),
});
export type Loop = z.infer<typeof Loop>;

/** Free grant databases: NSF and NIH (US), UKRI (UK), CORDIS (EU, ERC), ARC (Australia). */
export const AwardSource = z.enum(["NSF", "NIH", "UKRI", "CORDIS", "ARC"]);
export type AwardSource = z.infer<typeof AwardSource>;

export const Award = z.object({
  source: AwardSource,
  id: z.string(),
  title: z.string(),
  /** Empty when the database doesn't name one (CORDIS lists the host, not the PI). */
  pi: z.string(),
  university: z.string(),
  amount: z.number().nullable(),
  /** ISO 4217: USD, GBP, EUR, AUD. */
  currency: z.string(),
  /** The award's own page. */
  url: z.string(),
  starts: z.string().nullable(),
  ends: z.string().nullable(),
  /** Whole months the award still runs after the intake starts. Negative: ends before. */
  monthsAfterIntake: z.number().nullable(),
  inSheet: z.boolean(),
  abstract: z.string(),
});
export type Award = z.infer<typeof Award>;
