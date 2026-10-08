// The vault: an hq inside the app. Documents with their files, opportunities (scholarships,
// programs, applications) and "To file", where the agent's finds wait for a click.
import { z } from "zod";
import { Degree } from "./domain.ts";

export const DocKind = z.enum([
  "cv",
  "transcript",
  "passport",
  "test",
  "certificate",
  "letter",
  "other",
]);
export type DocKind = z.infer<typeof DocKind>;

/** A file the applicant keeps here. The bytes live under GETMYPROF_HOME/files. */
export const VaultDocument = z.object({
  id: z.string(),
  name: z.string(),
  kind: DocKind,
  mime: z.string(),
  size: z.number(),
  /** YYYY-MM-DD, for passports, test scores and anything else that runs out. */
  expires: z.string().nullable(),
  uploadedAt: z.string(),
  /** sha256 of the bytes, so adding the same file twice keeps one copy. */
  sha256: z.string().default(""),
});
export type VaultDocument = z.infer<typeof VaultDocument>;

const sources = z.array(z.string());

export const Scholarship = z.object({
  id: z.string(),
  name: z.string(),
  sponsor: z.string(),
  /** Where it pays for study, e.g. "USA", "UK", "any". */
  studyIn: z.string(),
  /** Citizenships it is open to; empty means any. */
  citizenship: z.array(z.string()),
  tracks: z.array(Degree),
  amount: z.string(),
  deadline: z.string().nullable(),
  url: z.string(),
  sources,
  status: z.enum(["watch", "applying", "applied", "won", "lost"]),
  note: z.string(),
});
export type Scholarship = z.infer<typeof Scholarship>;

export const Program = z.object({
  id: z.string(),
  university: z.string(),
  name: z.string(),
  degree: Degree,
  deadline: z.string().nullable(),
  fee: z.string(),
  waiver: z.string(),
  /** English rules, e.g. "IELTS 7.0; MOI accepted". */
  english: z.string(),
  /** How admits are funded, e.g. "5 years guaranteed, RA/TA". */
  funding: z.string(),
  /** What the statement must cover, in the program's words, one item per line. */
  asks: z.string().default(""),
  /** The statement's length limit, e.g. "2 pages" or "1000 words". */
  limit: z.string().default(""),
  /** "ok", or "no: <why>" when this applicant can't be admitted or funded here. */
  eligibility: z.string().default(""),
  url: z.string(),
  sources,
  note: z.string(),
});
export type Program = z.infer<typeof Program>;

export const AppStatus = z.enum([
  "planning",
  "in-progress",
  "submitted",
  "interview",
  "admitted",
  "waitlisted",
  "rejected",
  "declined",
]);
export type AppStatus = z.infer<typeof AppStatus>;

/** One application to one program: the checklist, recommenders, portal and who to name. */
export const Application = z.object({
  id: z.string(),
  programId: z.string(),
  status: AppStatus,
  waiver: z.enum(["none", "requested", "granted", "denied"]),
  documents: z.array(
    z.object({ name: z.string(), docId: z.string().nullable(), done: z.boolean() }),
  ),
  recommenders: z.array(
    z.object({
      name: z.string(),
      email: z.string(),
      status: z.enum(["to-ask", "asked", "agreed", "submitted"]),
    }),
  ),
  portal: z.string(),
  portalStatus: z.string(),
  /** The portal's application number, quoted in "I applied and named you" notes. */
  applicationId: z.string().default(""),
  /** Professors to name in the application, by record key. */
  professors: z.array(z.string()),
  submittedAt: z.string().nullable(),
  note: z.string(),
  /** Interviews: who with, and when (local date and time). Prep packs find them by name. */
  interviews: z.array(z.object({ id: z.string(), with: z.string(), at: z.string() })).default([]),
});
export type Application = z.infer<typeof Application>;

/** A funding offer. Compared by what's left of the stipend after rent. */
export const Offer = z.object({
  id: z.string(),
  university: z.string(),
  program: z.string(),
  stipend: z.number().nullable(),
  stipendPer: z.enum(["year", "month"]),
  currency: z.string(),
  tuition: z.enum(["full", "partial", "none"]),
  years: z.number().nullable(),
  insurance: z.string(),
  /** Teaching or research duties that come with the money, e.g. "TA 20h/week". */
  duties: z.string(),
  rentPerMonth: z.number().nullable(),
  /** YYYY-MM-DD; US programs answer by April 15. */
  respondBy: z.string().nullable(),
  status: z.enum(["open", "negotiating", "accepted", "declined"]),
  note: z.string(),
});
export type Offer = z.infer<typeof Offer>;

/**
 * sop, cv, essay, letter (a negotiation) and note (to a recommender) leave the app; prep (an
 * interview pack) and visa (the steps after accepting) stay private.
 */
export const WritingKind = z.enum(["sop", "cv", "essay", "prep", "letter", "note", "visa"]);
export type WritingKind = z.infer<typeof WritingKind>;

/**
 * A statement of purpose, CV or essay. `body` cites facts as [1], [2]; `citations` maps each
 * number to a profile fact id. A citation to a fact without proof blocks export.
 */
export const Writing = z.object({
  id: z.string(),
  kind: WritingKind,
  title: z.string(),
  programId: z.string().nullable(),
  scholarshipId: z.string().nullable(),
  draft: z.number().int(),
  body: z.string(),
  citations: z.record(z.string(), z.string()),
  threadId: z.string().nullable(),
  updatedAt: z.string(),
  /** Earlier drafts, newest last, so a revision never loses the text it replaced. */
  history: z
    .array(
      z.object({
        draft: z.number().int(),
        body: z.string(),
        citations: z.record(z.string(), z.string()),
        at: z.string(),
      }),
    )
    .default([]),
});
export type Writing = z.infer<typeof Writing>;

const finding = {
  id: z.string(),
  why: z.string(),
  threadId: z.string().nullable(),
  createdAt: z.string(),
};

/** Something the agent found that waits for a click before it becomes part of the vault. */
export const FileItem = z.discriminatedUnion("kind", [
  z.object({
    ...finding,
    kind: z.literal("scholarship"),
    item: Scholarship.omit({ id: true, status: true, note: true }),
  }),
  z.object({
    ...finding,
    kind: z.literal("program"),
    item: Program.omit({ id: true, note: true }),
  }),
]);
export type FileItem = z.infer<typeof FileItem>;

export const VaultState = z.object({
  documents: z.array(VaultDocument),
  scholarships: z.array(Scholarship),
  programs: z.array(Program),
  applications: z.array(Application),
  offers: z.array(Offer),
  writing: z.array(Writing),
  toFile: z.array(FileItem),
});
export type VaultState = z.infer<typeof VaultState>;

/** What `vault.save` takes: one edited item of any kind. */
export const VaultEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), value: VaultDocument }),
  z.object({ kind: z.literal("scholarship"), value: Scholarship }),
  z.object({ kind: z.literal("program"), value: Program }),
  z.object({ kind: z.literal("application"), value: Application }),
  z.object({ kind: z.literal("writing"), value: Writing }),
  z.object({ kind: z.literal("offer"), value: Offer }),
]);
export type VaultEdit = z.infer<typeof VaultEdit>;
export type VaultKind = VaultEdit["kind"];
