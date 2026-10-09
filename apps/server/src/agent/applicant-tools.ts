// Tools that act on the applicant's side of the hunt: drafting mail, reading replies, filing
// finds into the vault, and writing statements. tools.ts lists them with the research tools.
import {
  Channel,
  Degree,
  ReplyClass,
  School,
  SchoolTier,
  Touch,
  WritingKind,
} from "@getmyprof/contracts";
import { z } from "zod";
import { classify } from "../outreach/inbox.ts";
import { getMessage, issuesFor, saveDraft } from "../outreach/store.ts";
import { recordKey } from "../records.ts";
import {
  listOffers,
  listPrograms,
  proposeFinding,
  proposeSchool,
  saveEdit,
  saveWriting,
  setSchoolMoney,
} from "../vault.ts";
import type { HuntTool } from "./tools.ts";

const define = <S extends z.ZodRawShape>(t: HuntTool<S>) => t;

const ADMIT_RATE = z
  .string()
  .describe(
    "The department's own published PhD admit rate with its year, e.g. '7% of PhD applicants, 2025 (department report)'. Never from GradCafe or a ranking site; leave it out when the department publishes none",
  );
const GPA_MIN = z
  .string()
  .describe(
    "The published GPA minimum with its scale, e.g. '3.0 / 4.0'; leave it out when none is stated",
  );
const CONFLICTS = z
  .string()
  .describe(
    "When the department's and the graduate school's pages disagree (deadline, GRE, English rules), use the earlier deadline and record both values and both pages here, e.g. 'deadline: Dec 1 (cs.x.edu/phd) vs Dec 15 (grad.x.edu)'",
  );
const STIPEND = z
  .number()
  .positive()
  .describe("The yearly PhD stipend in USD, from a page that states it");
const RENT = z
  .number()
  .positive()
  .describe("Median monthly rent in USD for a one-bedroom near campus, from a page that states it");

export const APPLICANT_TOOLS = [
  define({
    name: "set_offer_rent",
    description:
      "Record the local monthly rent (USD, a 1-bedroom near campus) on an offer in the Vault, from a page that states it, so offers compare after rent. Give the offer id and the page.",
    shape: {
      offerId: z.string(),
      usdPerMonth: z.number().positive(),
      source: z.string().describe("The page the figure is from"),
    },
    paid: false,
    price: () => 0,
    run: async ({ offerId, usdPerMonth, source }, ctx) => {
      const offer = listOffers(ctx.db).find((o) => o.id === offerId);
      if (!offer) return { summary: "no offer", text: `No offer ${offerId} in the Vault.` };
      saveEdit(ctx.db, {
        kind: "offer",
        value: { ...offer, rentPerMonth: Math.round(usdPerMonth) },
      });
      ctx.vaultChanged();
      return {
        summary: `$${Math.round(usdPerMonth)} a month`,
        text: `Saved on the offer at ${offer.university}, from ${source}. Say the source in your reply.`,
      };
    },
  }),
  define({
    name: "draft_email",
    description:
      "Draft an email (or a LinkedIn note) to a professor in the sheet. It waits for the applicant to approve; nothing is sent by you. Email goes only to the address already in the sheet; apply-only professors get none. Plain text, one recipient, at most two links. A first LinkedIn note stays under 200 characters, so it also fits a connection request. Cite each claim about the applicant with [[fact-id]] right after it, as in the Writer; an uncited or unproven claim keeps the draft from being approved. A first message follows the first email playbook: their name, one recent paper of theirs by title and a detail of it, a specific subject, under 150 words, no generic praise; the checks block one that misses.",
    shape: {
      name: z.string(),
      university: z.string(),
      channel: Channel.default("email"),
      touch: Touch.describe(
        "first: who they are, one fit fact, one question. follow-up-1: a short bump with a new angle. follow-up-2: a last note offering a CV or a call. reply: an answer to their message. after-applying: 'I applied and named you'",
      ),
      to: z.string().describe("Their address from the sheet, or their LinkedIn profile URL"),
      subject: z
        .string()
        .describe("Follow their contact rule, e.g. 'PhD 2027'. Empty for a reply keeps theirs"),
      body: z
        .string()
        .describe(
          "Only claims backed by a confirmed fact about the applicant, each cited [[fact-id]]",
        ),
      timeZone: z
        .string()
        .describe("The professor's IANA time zone, e.g. America/Chicago; sends go at 08:00 there"),
      attach: z
        .array(z.string())
        .optional()
        .describe(
          "Vault document ids to attach (email only): the CV on a first email, or what they asked for",
        ),
    },
    paid: false,
    price: () => 0,
    run: async (args, ctx) => {
      const draft = saveDraft(ctx.db, {
        recordKey: recordKey(args.name, args.university),
        channel: args.channel,
        touch: args.touch,
        to: args.to,
        subject: args.subject,
        body: args.body,
        timeZone: args.timeZone,
        threadId: ctx.threadId,
        attach: args.attach,
      });
      if ("problem" in draft)
        return { summary: "not drafted", text: `Not drafted: ${draft.problem}.` };
      ctx.outreachChanged();
      const issues = issuesFor(ctx.db, draft);
      return issues.length
        ? {
            summary: `${args.touch} drafted · blocked`,
            text: `Drafted, but it can't be approved yet: ${issues.join("; ")}. Fix it and call draft_email again for the same touch.`,
          }
        : {
            summary: `${args.touch} drafted`,
            text: "Drafted. It waits in Pipeline for the applicant to approve.",
          };
    },
  }),
  define({
    name: "classify_reply",
    description:
      "Record what a professor's reply means, so the pipeline moves: interested, call (they propose a call), apply-first, not-taking (stops follow-ups), needs-info.",
    shape: {
      messageId: z.string().describe("The id given with the reply"),
      replyClass: ReplyClass,
      note: z
        .string()
        .describe("What they ask for, in a few words, e.g. 'asks for CV and a research note'"),
    },
    paid: false,
    price: () => 0,
    run: async (args, ctx) => {
      if (!getMessage(ctx.db, args.messageId))
        return { summary: "unknown message", text: `No message ${args.messageId}.` };
      classify(ctx.db, args.messageId, args.replyClass, args.note);
      ctx.outreachChanged();
      return { summary: args.replyClass, text: "Recorded." };
    },
  }),
  define({
    name: "propose_program",
    description:
      "File a program the applicant could apply to. It waits in their To file until they click File. One call per program, with sources.",
    shape: {
      university: z.string(),
      name: z.string().describe("The program's own name, e.g. 'PhD in Information Technology'"),
      degree: Degree,
      deadline: z.string().nullable().describe("YYYY-MM-DD for the applicant's intake, or null"),
      fee: z.string().describe("Application fee, e.g. '$75'"),
      waiver: z.string().describe("Fee waiver rules for this applicant, or 'none found'"),
      english: z.string().describe("English rules, e.g. 'IELTS 6.5; MOI considered'"),
      funding: z.string().describe("How admits are funded, e.g. '5 years guaranteed, RA/TA'"),
      asks: z
        .string()
        .describe(
          "What the statement must cover, in the program's words, one item per line; empty if none",
        ),
      limit: z
        .string()
        .describe("The statement's length limit, e.g. '2 pages' or '1000 words'; empty if none"),
      eligibility: z
        .string()
        .describe('"ok", or "no: <why>" when this applicant can\'t be admitted or funded here'),
      conflicts: CONFLICTS.optional(),
      admitRate: ADMIT_RATE.optional(),
      gpaMin: GPA_MIN.optional(),
      url: z.string(),
      sources: z.array(z.string()).min(1),
      why: z.string().describe("One line: why it fits this applicant"),
    },
    paid: false,
    price: () => 0,
    run: async ({ why, ...item }, ctx) => {
      const r = proposeFinding(ctx.db, { kind: "program", item, why, threadId: ctx.threadId });
      if ("skipped" in r) return { summary: r.skipped, text: `Not filed: ${r.skipped}.` };
      ctx.vaultChanged();
      return { summary: "to file", text: "Waiting in the applicant's To file." };
    },
  }),
  define({
    name: "propose_school",
    description:
      "Suggest a school for the applicant's shortlist, in a tier for them. It waits on the Schools page until they keep or drop it; a dropped school can't come back. One call per school, with sources.",
    shape: {
      name: z.string().describe("The university's own name, as professors' pages write it"),
      country: z.string(),
      tier: SchoolTier,
      rank: z.string().describe("Its rank in the field and the source, e.g. 'CSRankings #52, NLP'"),
      admits: School.shape.admits.describe(
        "committee: a program admits; advisor: professors hire for their labs",
      ),
      why: z.string().describe("One line: why this tier for this applicant"),
      stipendUsd: STIPEND.optional(),
      rentUsd: RENT.optional(),
      sources: z.array(z.string()).min(1),
    },
    paid: false,
    price: () => 0,
    run: async (args, ctx) => {
      const r = proposeSchool(ctx.db, args);
      if ("skipped" in r) return { summary: r.skipped, text: `Not suggested: ${r.skipped}.` };
      ctx.vaultChanged();
      return { summary: `suggested · ${r.tier}`, text: "Waiting on the Schools page." };
    },
  }),
  define({
    name: "set_school_money",
    description:
      "Record what a school on the shortlist pays and what living there costs, so schools compare by the stipend left after rent. Give the page each figure is from.",
    shape: {
      name: z.string().describe("The school's name as the shortlist has it"),
      stipendUsd: STIPEND.optional(),
      rentUsd: RENT.optional(),
      source: z.string().describe("The page the figures are from"),
    },
    paid: false,
    price: () => 0,
    run: async ({ name, source, ...money }, ctx) => {
      const school = setSchoolMoney(ctx.db, name, money, source);
      if (!school)
        return { summary: "no school", text: `No school named ${name} on the shortlist.` };
      ctx.vaultChanged();
      return {
        summary: `stipend ${school.stipendUsd ?? "?"} · rent ${school.rentUsd ?? "?"}`,
        text: `Saved on ${school.name}, from ${source}.`,
      };
    },
  }),
  define({
    name: "note_program",
    description:
      "Add notes to a program already in the applicant's Vault: last cycle's decision timing, or where official pages disagree. Notes, not commitments, so they save directly.",
    shape: {
      programId: z.string(),
      decisions: z
        .string()
        .optional()
        .describe(
          "Last cycle's interview and decision dates from GradCafe reports, with how many reports and how many international, e.g. 'interviews late Jan; decisions Feb 10 to Mar 5 (14 reports, 4 international)'. Self-reported: never odds",
        ),
      conflicts: CONFLICTS.optional(),
      admitRate: ADMIT_RATE.optional(),
      gpaMin: GPA_MIN.optional(),
      source: z.string().describe("The page the notes are from"),
    },
    paid: false,
    price: () => 0,
    run: async ({ programId, source, ...notes }, ctx) => {
      const program = listPrograms(ctx.db).find((p) => p.id === programId);
      if (!program) return { summary: "no program", text: `No program ${programId} in the Vault.` };
      saveEdit(ctx.db, {
        kind: "program",
        value: {
          ...program,
          decisions: notes.decisions ?? program.decisions,
          conflicts: notes.conflicts ?? program.conflicts,
          admitRate: notes.admitRate ?? program.admitRate,
          gpaMin: notes.gpaMin ?? program.gpaMin,
          sources: program.sources.includes(source)
            ? program.sources
            : [...program.sources, source],
        },
      });
      ctx.vaultChanged();
      return { summary: "noted", text: `Noted on ${program.university} · ${program.name}.` };
    },
  }),
  define({
    name: "propose_scholarship",
    description:
      "File a scholarship the applicant is eligible for (check citizenship and degree track). It waits in their To file until they click File. One call each, with sources.",
    shape: {
      name: z.string(),
      sponsor: z.string(),
      studyIn: z.string().describe("Where it pays for study, e.g. 'USA', 'UK', 'any'"),
      citizenship: z.array(z.string()).describe("Citizenships it is open to; empty for any"),
      tracks: z.array(Degree),
      amount: z.string().describe("What it pays, e.g. 'tuition, stipend, travel'"),
      deadline: z.string().nullable().describe("YYYY-MM-DD of the next round, or null"),
      url: z.string(),
      sources: z.array(z.string()).min(1),
      why: z.string().describe("One line: why the applicant qualifies"),
    },
    paid: false,
    price: () => 0,
    run: async ({ why, ...item }, ctx) => {
      const r = proposeFinding(ctx.db, { kind: "scholarship", item, why, threadId: ctx.threadId });
      if ("skipped" in r) return { summary: r.skipped, text: `Not filed: ${r.skipped}.` };
      ctx.vaultChanged();
      return { summary: "to file", text: "Waiting in the applicant's To file." };
    },
  }),
  define({
    name: "write_document",
    description:
      "Save a statement of purpose, CV or scholarship essay into the applicant's Writer. Cite each claim about the applicant with [[fact-id]] right after it. Saving again with pieceId makes the next draft.",
    shape: {
      pieceId: z.string().nullable().describe("The piece to revise, or null for a new one"),
      kind: WritingKind,
      title: z.string(),
      programId: z.string().nullable(),
      scholarshipId: z.string().nullable(),
      text: z
        .string()
        .describe("Plain text with [[fact-id]] citations; blank lines between paragraphs"),
    },
    paid: false,
    price: () => 0,
    run: async (args, ctx) => {
      const piece = saveWriting(ctx.db, { ...args, threadId: ctx.threadId });
      ctx.vaultChanged();
      return {
        summary: `draft ${piece.draft} · ${Object.keys(piece.citations).length} facts cited`,
        text: "Saved. The applicant reviews it in the Writer.",
      };
    },
  }),
];
