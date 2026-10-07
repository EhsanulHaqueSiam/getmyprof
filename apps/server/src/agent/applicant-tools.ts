// Tools that act on the applicant's side of the hunt: drafting mail, reading replies, filing
// finds into the vault, and writing statements. tools.ts lists them with the research tools.
import { Channel, Degree, ReplyClass, Touch, WritingKind } from "@gradcode/contracts";
import { z } from "zod";
import { classify, getMessage, saveDraft } from "../outreach/store.ts";
import { recordKey } from "../records.ts";
import { proposeFinding, saveWriting } from "../vault.ts";
import type { HuntTool } from "./tools.ts";

const define = <S extends z.ZodRawShape>(t: HuntTool<S>) => t;

export const APPLICANT_TOOLS = [
  define({
    name: "draft_email",
    description:
      "Draft an email (or a LinkedIn note) to a professor in the sheet. It waits for the applicant to approve; nothing is sent by you. Email goes only to the address already in the sheet; apply-only professors get none. Plain text, one recipient, at most two links.",
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
      body: z.string().describe("Only claims backed by a confirmed fact about the applicant"),
      timeZone: z
        .string()
        .describe("The professor's IANA time zone, e.g. America/Chicago; sends go at 08:00 there"),
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
      });
      if ("problem" in draft)
        return { summary: "not drafted", text: `Not drafted: ${draft.problem}.` };
      ctx.outreachChanged();
      return {
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
