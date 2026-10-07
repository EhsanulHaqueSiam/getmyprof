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

/** A file the applicant keeps here. The bytes live under GRADCODE_HOME/files. */
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
  url: z.string(),
  sources,
  note: z.string(),
});
export type Program = z.infer<typeof Program>;

export const AppStatus = z.enum([
  "planning",
  "in-progress",
  "submitted",
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
  /** Professors to name in the application, by record key. */
  professors: z.array(z.string()),
  submittedAt: z.string().nullable(),
  note: z.string(),
});
export type Application = z.infer<typeof Application>;

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
  toFile: z.array(FileItem),
});
export type VaultState = z.infer<typeof VaultState>;

/** What `vault.save` takes: one edited item of any kind. */
export const VaultEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), value: VaultDocument }),
  z.object({ kind: z.literal("scholarship"), value: Scholarship }),
  z.object({ kind: z.literal("program"), value: Program }),
  z.object({ kind: z.literal("application"), value: Application }),
]);
export type VaultEdit = z.infer<typeof VaultEdit>;
export type VaultKind = VaultEdit["kind"];
