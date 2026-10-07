// The hunt tools the agent calls. Both providers run these same handlers: Claude through an
// in-process MCP server, the fake provider directly. A handler returns a one-line summary
// (shown in the work log) and the full text the model reads.
import { type Hunt, type Settings, Stage } from "@gradcode/contracts";
import { z } from "zod";
import type { Db } from "../db.ts";
import { propose, listRecords } from "../records.ts";
import {
  type Author,
  TREG_PRICES,
  intakeStart,
  monthsAfter,
  nihAwards,
  nsfAwards,
  openAlexAuthor,
  tregCall,
} from "../sources.ts";
import { daySpend, getThread, recordSpend, threadSpend } from "../threads.ts";
import { APPLICANT_TOOLS } from "./applicant-tools.ts";

export type Sources = {
  nsf: typeof nsfAwards;
  nih: typeof nihAwards;
  openalex: (name: string, university?: string) => Promise<Author | null>;
  treg: typeof tregCall;
};

export const realSources: Sources = {
  nsf: nsfAwards,
  nih: nihAwards,
  openalex: openAlexAuthor,
  treg: tregCall,
};

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
const money = (usd: number | null) =>
  usd == null ? "?" : `$${Math.round(usd).toLocaleString("en-US")}`;

const awardLines = async (
  ctx: ToolContext,
  which: "nsf" | "nih",
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
      `${a.source} ${a.id} | PI ${a.pi} | ${a.university} | ${money(a.usd)} | ends ${a.ends ?? "?"} | ${monthsAfter(a.ends, start) ?? "?"} months after intake | ${a.title}`,
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
    description: `Paid data lookups through treg, for when free sources fail. Allowed endpoints and USD per call: ${Object.entries(
      TREG_PRICES,
    )
      .map(([e, p]) => `${e} $${p}`)
      .join(", ")}. Calls over the applicant's limit wait for approval.`,
    shape: {
      endpoint: z.string(),
      data: z.record(z.string(), z.unknown()).describe("The endpoint's JSON body"),
      purpose: z.string().describe("One line shown to the applicant: what this lookup is for"),
    },
    paid: true,
    price: (args) => TREG_PRICES[args.endpoint] ?? Number.POSITIVE_INFINITY,
    run: async (args, ctx) => {
      const price = TREG_PRICES[args.endpoint];
      if (price === undefined)
        return { summary: "refused", text: `${args.endpoint} is not an allowed endpoint.` };
      const cap = capProblem(ctx, price);
      if (cap) return { summary: "over budget", text: cap };
      const result = await ctx.sources.treg(args.endpoint, args.data);
      recordSpend(ctx.db, ctx.threadId, args.endpoint, price);
      ctx.changed();
      return {
        summary: `${price ? `$${price}` : "free"}`,
        text: JSON.stringify(result).slice(0, 4000),
      };
    },
  }),
];

/** Why a paid call would break a cap, or null when it fits. */
export function capProblem(ctx: Pick<ToolContext, "db" | "threadId" | "settings">, price: number) {
  const { budget } = ctx.settings;
  const thread = getThread(ctx.db, ctx.threadId);
  const threadCap = thread?.loopId ? budget.perLoopRun : budget.perThread;
  if (threadSpend(ctx.db, ctx.threadId) + price > threadCap)
    return `This would pass the $${threadCap} cap for this ${thread?.loopId ? "loop run" : "thread"}.`;
  if (daySpend(ctx.db) + price > budget.perDay)
    return `This would pass today's $${budget.perDay} cap.`;
  return null;
}

/** Tools available to this install: treg only when it's switched on. */
export const toolsFor = (settings: Settings) =>
  HUNT_TOOLS.filter((t) => t.name !== "treg" || settings.treg);
