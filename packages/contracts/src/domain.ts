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

/**
 * A treg key to connect: the user's own team's, or one issued to them. An issued key is pinned
 * to its customer by treg, so the customer never has to be typed.
 */
export const TregConnect = z.object({ token: z.string().trim().min(8) });
export type TregConnect = z.infer<typeof TregConnect>;

/** Paid lookups on this install: the treg team behind the key, who pays, and this month's cost. */
export const TregStatus = z.object({
  connected: z.boolean(),
  /** The treg team the key belongs to. */
  org: z.string(),
  /** Issued by that team to this user, so the team pays; otherwise the key is the user's own. */
  issued: z.boolean(),
  /** An owner or admin of the team: may manage its customers and see its balance. */
  manage: z.boolean(),
  month: z.object({
    usd: z.number(),
    calls: z.number(),
    byFeature: z.array(z.object({ feature: z.string(), usd: z.number(), calls: z.number() })),
  }),
});
export type TregStatus = z.infer<typeof TregStatus>;

/** The free sources setup lists. "web" is the agent's own web search and page reading. */
export const FREE_SOURCES = ["NSF", "NIH", "OpenAlex", "CSRankings", "web"] as const;
export const FreeSource = z.enum(FREE_SOURCES);
export type FreeSource = z.infer<typeof FreeSource>;

/** One customer of a treg team: a key pinned to them, what they spent, and their daily limit. */
export const TregCustomer = z.object({
  id: z.string(),
  since: z.string(),
  monthUsd: z.number(),
  calls: z.number(),
  todayUsd: z.number(),
  /** Their own limit, else the team default; null when there is none. */
  dailyUsd: z.number().nullable(),
  ownLimit: z.boolean(),
  status: z.enum(["active", "at-limit", "blocked"]),
  /** This month's spend by getmyprof feature (hunt, loop, row-email...), from their calls' tags. */
  byFeature: z.array(z.object({ feature: z.string(), usd: z.number() })),
});
export type TregCustomer = z.infer<typeof TregCustomer>;

/** A team's customers, its balance, and this month's spend: billed to customers, and its own. */
export const TregCustomers = z.object({
  balanceUsd: z.number(),
  defaultDailyUsd: z.number().nullable(),
  billedUsd: z.number(),
  ownUseUsd: z.number(),
  customers: z.array(TregCustomer),
  /** How the team pays; null where treg offers no top-ups. */
  billing: z
    .object({
      minTopUpUsd: z.number(),
      /** treg's top-up amounts, with the bonus it adds to bigger ones. */
      topUps: z.array(z.object({ usd: z.number(), bonusUsd: z.number() })),
      /** Adds `addUsd` whenever the balance drops under `underUsd`, at most `monthCapUsd` a month. */
      auto: z.object({
        on: z.boolean(),
        underUsd: z.number(),
        addUsd: z.number(),
        monthCapUsd: z.number(),
        cardOnFile: z.boolean(),
        /** Why treg switched it off (a card declined...); empty when nothing is wrong. */
        problem: z.string(),
      }),
    })
    .nullable(),
});
export type TregCustomers = z.infer<typeof TregCustomers>;

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
  /** Bearer token other agents use to reach getmyprof's own MCP endpoint, /api/mcp. */
  mcpToken: z.string(),
  /** Free sources the agent may use; switching one off removes its tools. No default, as above. */
  freeSources: z.array(FreeSource),
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
  /** Booked or planned, not done yet, e.g. a test date: never claimed as done. */
  planned: z.boolean().default(false),
});
export type ProfileFact = z.infer<typeof ProfileFact>;

/** A fact can be written into something only once it's confirmed and has its proof. */
export function factStatus(f: ProfileFact) {
  if (f.question) return "question";
  if (f.planned) return "planned";
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
  /** The scale the GPA is on, e.g. "4.00" or "10", so it's never read on the wrong one. */
  gpaScale: z.string().default(""),
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
  /** Their LinkedIn profile URL, for a note when no checked address exists. */
  linkedin: z.string().default(""),
  /** Their Google Scholar profile URL. */
  scholar: z.string().default(""),
  /** Their latest papers or projects, newest first, each dated: shows they are still active. */
  recent: z.string().default(""),
  /** What they want students to work on or bring, in their words. */
  seeking: z.string().default(""),
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
  "linkedin",
  "scholar",
  "recent",
  "seeking",
] as const;
export type ProfessorField = (typeof PROFESSOR_FIELDS)[number];

export const Change = z.object({
  field: z.enum(PROFESSOR_FIELDS),
  from: z.string().nullable(),
  to: z.string(),
  /** The page that set the value this replaces, when the new sources don't include it: two
   * sources disagree, and Review asks which is right. */
  disagrees: z.string().optional(),
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

/**
 * What a thread is about: a professor in the sheet or a school. Naming one with @, or starting
 * from a row, puts what the sheet knows into the agent's context so it needn't fetch it again.
 */
export const ScopeItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("professor"), key: z.string(), name: z.string() }),
  z.object({ kind: z.literal("school"), name: z.string() }),
]);
export type ScopeItem = z.infer<typeof ScopeItem>;

/**
 * What a loop may accept without review. A change goes straight to the sheet when every rule
 * that's on holds for the record as it would be; with none on, everything waits in Review.
 */
export const AutoRules = z.object({
  /** The address is checked (ok, valid, from an official page). */
  verifiedEmail: z.boolean(),
  /** A source is the university's own page. */
  officialSource: z.boolean(),
  /** Fit 4 or more. */
  fit4: z.boolean(),
});
export type AutoRules = z.infer<typeof AutoRules>;

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
  /** The schools and professors each run works on; their sheet rows ride along. */
  scope: z.array(ScopeItem).default([]),
  /** Propose only (everything waits in Review), or accept what passes `rules`. */
  autonomy: z.enum(["propose", "auto"]).default("propose"),
  rules: AutoRules.default({ verifiedEmail: true, officialSource: true, fit4: false }),
  /** Paid calls up to this many USD go without asking in its runs ("Always under $x here"). */
  allowUnder: z.number().default(0),
});
export type Loop = z.infer<typeof Loop>;

/** A loop as its table shows it: with what its runs found and spent in the last 7 days. */
export const LoopRow = Loop.extend({ found7d: z.number(), spend7d: z.number() });
export type LoopRow = z.infer<typeof LoopRow>;

/** Scout, gradhunt's own nightly loop on Siam's install, shown read-only. */
export const ScoutLoop = z.object({
  when: z.string(),
  lastRun: z.string(),
  summary: z.string(),
  found7d: z.number(),
});
export type ScoutLoop = z.infer<typeof ScoutLoop>;

/** Free grant databases: NSF and NIH (US), UKRI (UK), CORDIS (EU, ERC), ARC (Australia), DFG (Germany), NSERC (Canada). */
export const AwardSource = z.enum(["NSF", "NIH", "UKRI", "CORDIS", "ARC", "DFG", "NSERC"]);
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
  /** How many of the hunt's fields its title and abstract name; 0 is off topic. */
  fit: z.number().default(0),
});
export type Award = z.infer<typeof Award>;
