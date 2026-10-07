// The hunt tools the agent calls. Both providers run these same handlers: Claude through an
// in-process MCP server, the fake provider directly. A handler returns a one-line summary
// (shown in the work log) and the full text the model reads.
import { type AwardSource, type Hunt, type Settings, Stage } from "@gradcode/contracts";
import { z } from "zod";
import type { Db } from "../db.ts";
import { listLoops } from "../loops.ts";
import { searchVault } from "../okf.ts";
import { propose, listRecords } from "../records.ts";
import {
  arcAwards,
  type Author,
  type AwardQuery,
  cordisAwards,
  intakeStart,
  monthsAfter,
  nihAwards,
  nsfAwards,
  openAlexAuthor,
  type RawAward,
  ukriAwards,
} from "../sources.ts";
import { TREG_ENDPOINTS, tregCall, type TregOutcome, type TregRequest } from "../treg.ts";
import { daySpend, getThread, recordSpend, threadSpend } from "../threads.ts";
import { APPLICANT_TOOLS } from "./applicant-tools.ts";

type AwardFetch = (q: AwardQuery) => Promise<RawAward[]>;

/** Every grant database by key, plus OpenAlex and treg. The fake provider swaps in fixtures. */
export type Sources = {
  nsf: AwardFetch;
  nih: AwardFetch;
  ukri: AwardFetch;
  cordis: AwardFetch;
  arc: AwardFetch;
  openalex: (name: string, university?: string) => Promise<Author | null>;
  treg: (req: TregRequest) => Promise<TregOutcome>;
};

export const realSources: Sources = {
  nsf: nsfAwards,
  nih: nihAwards,
  ukri: ukriAwards,
  cordis: cordisAwards,
  arc: arcAwards,
  openalex: openAlexAuthor,
  treg: (req) => tregCall(req),
};

const SOURCE_KEY = {
  NSF: "nsf",
  NIH: "nih",
  UKRI: "ukri",
  CORDIS: "cordis",
  ARC: "arc",
} as const satisfies Record<AwardSource, keyof Sources>;

/** An award source's key in Sources. */
export const sourceKey = (s: AwardSource) => SOURCE_KEY[s];

export type ToolContext = {
  db: Db;
  threadId: string;
  settings: Settings;
  hunt: Hunt | null;
  sources: Sources;
  /** Tells clients a thread's rows or review changed. */
  changed: () => void;
  /** Tells clients a draft or a reply changed. */
  outreachChanged: () => void;
  /** Tells clients the vault changed (a find landed in To file). */
  vaultChanged: () => void;
  /** Puts a question to the applicant; the thread waits in Input once the turn ends. */
  ask: (question: string) => void;
  /** What the turn is for, as a treg tag: hunt, loop, or row-<op> during a row action. */
  feature: () => string;
  /** A paid call hit a cap or was refused for good: a loop run stops here and says why. */
  capHit: (reason: string) => void;
  /** Money was spent: Settings' month total and the footer refresh. */
  spent: () => void;
};

export type ToolResult = { summary: string; text: string };

export type HuntTool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  shape: S;
  /** Paid tools go through approval and caps; free ones run without asking. */
  paid: boolean;
  /** USD for this call. Method syntax keeps HuntTool<S> assignable to HuntTool. */
  price(args: z.infer<z.ZodObject<S>>): number;
  run(args: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<ToolResult>;
};

const define = <S extends z.ZodRawShape>(t: HuntTool<S>) => t;
const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", AUD: "A$" };
const money = (amount: number | null, currency = "USD") =>
  amount == null
    ? "?"
    : `${SYMBOL[currency] ?? `${currency} `}${Math.round(amount).toLocaleString("en-US")}`;

const awardLines = async (
  ctx: ToolContext,
  which: "nsf" | "nih" | "ukri" | "cordis" | "arc",
  args: { terms: string[]; university?: string | undefined; pi?: string | undefined },
) => {
  const start = intakeStart(ctx.hunt?.prefs.intake ?? "");
  const activeAfter = start?.toISOString().slice(0, 10);
  const q = {
    terms: args.terms,
    ...(args.university ? { university: args.university } : {}),
    ...(args.pi ? { pi: args.pi } : {}),
    ...(activeAfter ? { activeAfter } : {}),
  };
  const awards = await ctx.sources[which](q);
  const lines = awards.map(
    (a) =>
      `${a.source} ${a.id} | PI ${a.pi || "not listed"} | ${a.university} | ${money(a.amount, a.currency)} | ends ${a.ends ?? "?"} | ${monthsAfter(a.ends, start) ?? "?"} months after intake | ${a.title}`,
  );
  return {
    summary: `${awards.length} award${awards.length === 1 ? "" : "s"} · free`,
    text: lines.join("\n") || "No active awards found.",
  };
};

const professorFields = {
  name: z.string().describe("Full name as written on their own page"),
  university: z.string().describe("University name"),
  department: z.string().optional(),
  niche: z.string().optional().describe("Their research area in a few words"),
  fit: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe("0-5 fit for this applicant, weighed by their priorities"),
  moneyTier: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe(
      "Money evidence tier: 1 clear (posted funded opening), 2 strong (active grant past the intake, new-hire startup, program funds every admit), 3 indirect (lab growing, gifts, students graduating), 4 none found",
    ),
  eligibility: z
    .string()
    .optional()
    .describe(
      '"ok", or "no: <why>" when this applicant cannot be paid here (citizenship-only funding, degree length)',
    ),
  taking: z
    .string()
    .optional()
    .describe('Are they taking students for the intake? "yes", "no", "not stated", or their words'),
  money: z.string().optional().describe("Their active funding, e.g. 'NSF CAREER $599,956'"),
  lasts: z
    .string()
    .optional()
    .describe("How long that money lasts, e.g. 'to May 2030' or 'not posted'"),
  email: z.string().optional().describe("Only an address printed on an official page"),
  emailCheck: z.string().optional().describe("ok, bounces, catch-all or unchecked"),
  contact: z
    .string()
    .optional()
    .describe("How they want to be reached, in their words, e.g. 'apply-only'"),
  stage: Stage.optional(),
  fitsBecause: z
    .string()
    .optional()
    .describe("Why they fit this applicant, citing a confirmed fact"),
  website: z.string().optional(),
  sources: z.array(z.string()).min(1).describe("URLs backing every value you set"),
};

export const HUNT_TOOLS = [
  define({
    name: "nsf_awards",
    description:
      "Search active NSF awards by topic terms, optionally at one university or for one PI. Free.",
    shape: {
      terms: z.array(z.string()).describe("Topic phrases"),
      university: z.string().optional(),
      pi: z.string().optional(),
    },
    paid: false,
    price: () => 0,
    run: (args, ctx) => awardLines(ctx, "nsf", args),
  }),
  define({
    name: "nih_awards",
    description:
      "Search active NIH awards (RePORTER) by topic terms, optionally at one university or for one PI. Free.",
    shape: {
      terms: z.array(z.string()),
      university: z.string().optional(),
      pi: z.string().optional(),
    },
    paid: false,
    price: () => 0,
    run: (args, ctx) => awardLines(ctx, "nih", args),
  }),
  define({
    name: "country_awards",
    description:
      "Search active grants outside the US by topic terms, optionally at one university or for one PI: UKRI (UK), CORDIS (EU Horizon and ERC; names the host, not the PI), ARC (Australia). Free.",
    shape: {
      source: z.enum(["UKRI", "CORDIS", "ARC"]),
      terms: z.array(z.string()),
      university: z.string().optional(),
      pi: z.string().optional(),
    },
    paid: false,
    price: () => 0,
    run: ({ source, ...args }, ctx) => awardLines(ctx, sourceKey(source), args),
  }),
  define({
    name: "openalex_author",
    description:
      "Look up a researcher on OpenAlex: institution, topics, citation counts and recent papers with links. Free.",
    shape: { name: z.string(), university: z.string().optional() },
    paid: false,
    price: () => 0,
    run: async (args, ctx) => {
      const a = await ctx.sources.openalex(args.name, args.university);
      if (!a) return { summary: "not found", text: "No matching OpenAlex author." };
      const recent = a.recent.map((w) => `- ${w.title} (${w.year}) ${w.link}`).join("\n");
      return {
        summary: `${a.works} works · ${a.citations} citations`,
        text: `${a.name}, ${a.institution}\nTopics: ${a.topics.join(", ")}\nRecent:\n${recent}`,
      };
    },
  }),
  define({
    name: "ask_applicant",
    description:
      "Ask the applicant something only they know (a fact, a plan, a preference) instead of guessing. After asking, end your turn; their answer arrives as the next message.",
    shape: { question: z.string().describe("One short question") },
    paid: false,
    price: () => 0,
    run: async ({ question }, ctx) => {
      ctx.ask(question);
      return { summary: "asked", text: "Asked. End your turn now and wait for the answer." };
    },
  }),
  define({
    name: "vault_search",
    description:
      "Search the applicant's vault (their facts with proof, documents, programs, applications, writing; on some installs their hq notes too) by words. Each hit comes with the notes it links to: a fact and its proof, a role and the paper from it. Use it before writing anything about the applicant. Free.",
    shape: { query: z.string().describe("Words to find, e.g. 'leadership team lab'") },
    paid: false,
    price: () => 0,
    run: async ({ query }, ctx) => {
      const hits = searchVault(ctx.db, query);
      if (hits.length === 0) return { summary: "nothing found", text: "No note matches." };
      return {
        summary: `${hits.length} note${hits.length === 1 ? "" : "s"}`,
        text: hits
          .map(
            (h) =>
              `${h.type} · ${h.title} (${h.path})\n  ${h.snippet}${h.linked.length ? `\n  linked: ${h.linked.map((l) => l.title || l.path).join("; ")}` : ""}`,
          )
          .join("\n"),
      };
    },
  }),
  define({
    name: "sheet_search",
    description:
      "List professors already in the applicant's sheet, so you don't re-research them. Free.",
    shape: { university: z.string().optional(), query: z.string().optional() },
    paid: false,
    price: () => 0,
    run: async (args, ctx) => {
      const want = (s: string, q?: string) => !q || s.toLowerCase().includes(q.toLowerCase());
      const rows = listRecords(ctx.db).filter(
        (p) => want(p.university, args.university) && want(`${p.name} ${p.niche}`, args.query),
      );
      return {
        summary: `${rows.length} in the sheet`,
        text:
          rows
            .slice(0, 40)
            .map(
              (p) =>
                `${p.name} | ${p.university} | fit ${p.fit} | money ${p.money || "?"} | taking ${p.taking || "?"} | email ${p.emailCheck || "?"} | ${p.stage}`,
            )
            .join("\n") || "Nothing yet.",
      };
    },
  }),
  define({
    name: "propose_professor",
    description:
      "Record what you found about a professor. New people become an add; known people an update with only the fields that changed. The applicant reviews every proposal. Call it once per professor, with sources.",
    shape: professorFields,
    paid: false,
    price: () => 0,
    run: async (args, ctx) => {
      const { name, university, sources, ...fields } = args;
      const result = propose(ctx.db, ctx.threadId, { name, university, sources, fields });
      if ("skipped" in result)
        return { summary: result.skipped, text: `Not proposed: ${result.skipped}.` };
      ctx.changed();
      const p = result.proposal;
      return {
        summary: `${p.kind} · ${p.changes.length} field${p.changes.length === 1 ? "" : "s"}`,
        text: `Proposed (${p.kind}) for review.`,
      };
    },
  }),
  ...APPLICANT_TOOLS,
  define({
    name: "treg",
    description: `Paid data lookups through treg, for when free sources fail. Allowed endpoints, usual USD per call and the most one call may cost: ${Object.entries(
      TREG_ENDPOINTS,
    )
      .map(([e, p]) => `${e} $${p.usd}${p.max > p.usd ? ` (up to $${p.max})` : ""}`)
      .join(", ")}. Calls over the applicant's limit wait for approval.`,
    shape: {
      endpoint: z.string(),
      data: z
        .record(z.string(), z.unknown())
        .describe("The endpoint's JSON body, or its query parameters for a GET endpoint"),
      purpose: z.string().describe("One line shown to the applicant: what this lookup is for"),
      about: z
        .string()
        .optional()
        .describe("The sheet key of the professor this lookup is for, when it is for one"),
    },
    paid: true,
    price: (args) => TREG_ENDPOINTS[args.endpoint]?.usd ?? Number.POSITIVE_INFINITY,
    run: async (args, ctx) => {
      const spec = TREG_ENDPOINTS[args.endpoint];
      if (!spec)
        return { summary: "refused", text: `${args.endpoint} is not an allowed endpoint.` };
      const cap = capProblem(ctx, spec.usd);
      if (cap) {
        ctx.capHit(cap);
        return { summary: "over budget", text: cap };
      }
      const feature = ctx.feature();
      const out = await ctx.sources.treg({
        endpoint: args.endpoint,
        data: args.data,
        maxUsd: Math.min(spec.max, budgetLeft(ctx)),
        tags: { thread: ctx.threadId, feature, hunt: ctx.hunt?.id },
      });
      if (out.costUsd > 0 || out.callId)
        recordSpend(ctx.db, {
          threadId: ctx.threadId,
          what: args.endpoint,
          usd: out.costUsd,
          callId: out.callId,
          feature,
          subject: args.about ?? null,
        });
      ctx.changed();
      ctx.spent();
      const cost = `${out.costUsd ? `$${Number(out.costUsd.toFixed(6))}` : "free"}`;
      if (!out.ok) {
        if (out.stop) ctx.capHit(out.reason);
        return { summary: `${out.stop ? "stopped" : "failed"} · ${cost}`, text: out.reason };
      }
      return { summary: cost, text: JSON.stringify(out.result).slice(0, 4000) };
    },
  }),
];

/** The tightest cap on this thread right now: its own (or its loop run's) and today's. */
function caps(ctx: Pick<ToolContext, "db" | "threadId" | "settings">) {
  const { budget } = ctx.settings;
  const thread = getThread(ctx.db, ctx.threadId);
  // A loop run is capped by its loop's own budget; a deleted loop falls back to the default.
  const loop = thread?.loopId ? listLoops(ctx.db).find((l) => l.id === thread.loopId) : null;
  const threadCap = thread?.loopId ? (loop?.budgetUsd ?? budget.perLoopRun) : budget.perThread;
  return {
    thread: { cap: threadCap, left: threadCap - threadSpend(ctx.db, ctx.threadId) },
    day: { cap: budget.perDay, left: budget.perDay - daySpend(ctx.db) },
    what: thread?.loopId ? "loop run" : "thread",
  };
}

/** USD a paid call may still spend here; it goes to treg as the call's hard ceiling. */
export const budgetLeft = (ctx: Pick<ToolContext, "db" | "threadId" | "settings">) => {
  const c = caps(ctx);
  return Math.max(0, Math.min(c.thread.left, c.day.left));
};

/** Why a paid call would break a cap, or null when it fits. */
export function capProblem(ctx: Pick<ToolContext, "db" | "threadId" | "settings">, price: number) {
  const c = caps(ctx);
  if (price > c.thread.left) return `This would pass the $${c.thread.cap} cap for this ${c.what}.`;
  if (price > c.day.left) return `This would pass today's $${c.day.cap} cap.`;
  return null;
}

/** Tools available to this install: treg only when it's switched on. */
export const toolsFor = (settings: Settings) =>
  HUNT_TOOLS.filter((t) => t.name !== "treg" || settings.treg);
