// Outreach: every message to or from a professor, by email or LinkedIn. The server stores
// messages; whose turn it is and the pipeline stage are derived from them, never stored.
import { z } from "zod";
import {
  addressChecked,
  type Applicant,
  factStatus,
  type ProfileFact,
  Professor,
  uncitedClaims,
  unbackedScore,
} from "./domain.ts";
import { AppStatus, Offer } from "./vault.ts";

export const Channel = z.enum(["email", "linkedin"]);
export type Channel = z.infer<typeof Channel>;

/** Which step of a sequence an outgoing message is. */
export const Touch = z.enum([
  "first",
  "follow-up-1",
  "follow-up-2",
  "after-applying",
  "reply",
  "thank-you",
]);
export type Touch = z.infer<typeof Touch>;

/** What an incoming message is, from its headers and first lines. */
export const MailKind = z.enum(["reply", "bounce", "auto-reply", "linkedin"]);
export type MailKind = z.infer<typeof MailKind>;

/** What a real reply says, as the agent reads it. */
export const ReplyClass = z.enum(["interested", "call", "apply-first", "not-taking", "needs-info"]);
export type ReplyClass = z.infer<typeof ReplyClass>;

export const OutreachMessage = z.object({
  id: z.string(),
  recordKey: z.string(),
  channel: Channel,
  direction: z.enum(["out", "in"]),
  /** Outgoing only. */
  touch: Touch.nullable(),
  /** Incoming only. */
  kind: MailKind.nullable(),
  replyClass: ReplyClass.nullable(),
  /** draft → scheduled → sent, or failed / cancelled. Incoming messages are "received". */
  status: z.enum(["draft", "scheduled", "sent", "failed", "cancelled", "received"]),
  from: z.string(),
  /** An email address, or a LinkedIn profile URL. */
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  /** The professor's IANA zone; first emails and follow-ups go out at 08:00 there. */
  timeZone: z.string(),
  scheduledAt: z.string().nullable(),
  /** Sent, or received, at. */
  at: z.string().nullable(),
  /** RFC 5322 Message-ID, so replies thread and match. */
  messageId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  /** The thread whose agent drafted it; replies go back there. */
  threadId: z.string().nullable(),
  /** One line: why sending failed, or what a reply asks for. */
  note: z.string(),
  /** Vault documents sent with it, by id, e.g. the CV a professor asked for. Email only. */
  attachments: z.array(z.string()).default([]),
  /** The facts a draft cites, by [n] marker: {"1": "fact-id"}. Markers never leave the app. */
  citations: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
});
export type OutreachMessage = z.infer<typeof OutreachMessage>;

/** Board columns. Applied and Offer join when applications land. */
export const PIPELINE_STAGES = [
  "to-contact",
  "contacted",
  "follow-up",
  "replied",
  "call",
  "applied",
  "offer",
] as const;
export const PipelineStage = z.enum([...PIPELINE_STAGES, "closed"]);
export type PipelineStage = z.infer<typeof PipelineStage>;

/** Inbox groups: whose move it is. */
export const Turn = z.enum(["yours", "follow-up", "approve", "queued", "theirs", "closed"]);
export type Turn = z.infer<typeof Turn>;

/** One professor in the pipeline: their messages and where things stand. */
export const Conversation = z.object({
  record: Professor,
  messages: z.array(OutreachMessage),
  stage: PipelineStage,
  turn: Turn,
  /** When the next follow-up is due, while the sequence still runs. */
  followUpAt: z.string().nullable(),
  /** Why follow-ups stopped: a reply, a bounce, "not taking", applying, or an accepted offer. */
  stopped: z.string().nullable(),
  lastAt: z.string(),
  /** The program at their school the applicant is aiming for, with its deadline. */
  program: z.object({ name: z.string(), deadline: z.string().nullable() }).nullable(),
  /** The submitted application that names them, and how it stands. */
  applied: z.object({ status: AppStatus, submittedAt: z.string().nullable() }).nullable(),
  /** An offer from their school. */
  offer: z.object({ status: Offer.shape.status }).nullable(),
});
export type Conversation = z.infer<typeof Conversation>;

/** Mailboxes that sign in with OAuth, each install with its own client, instead of an app password. */
export const MailProvider = z.enum(["google", "microsoft"]);
export type MailProvider = z.infer<typeof MailProvider>;

/** Starts a mailbox sign-in. `returnTo` is the Settings page the browser comes back to. */
export const MailSignIn = z.object({
  provider: MailProvider,
  clientId: z.string().min(1),
  clientSecret: z.string(),
  name: z.string().min(1),
  returnTo: z.string(),
});
export type MailSignIn = z.infer<typeof MailSignIn>;

/** The mailbox as the client sees it. The password never leaves the server. */
export const MailStatus = z.object({
  connected: z.boolean(),
  /** How it logs in: an app password, or a sign-in with Google or Microsoft. */
  via: z.enum(["password", "google", "microsoft"]),
  address: z.string(),
  name: z.string(),
  imapHost: z.string(),
  smtpHost: z.string(),
  /** Warm-up caps count weeks from here. */
  warmupStart: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  error: z.string(),
  /** How many first emails and follow-ups may go out today under the warm-up. */
  dailyCap: z.number(),
});
export type MailStatus = z.infer<typeof MailStatus>;

export const MailConnect = z.object({
  name: z.string().min(1),
  address: z.email(),
  password: z.string().min(1),
  imapHost: z.string().min(1),
  imapPort: z.number().int().positive(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().positive(),
});
export type MailConnect = z.infer<typeof MailConnect>;

/**
 * Why an outgoing message can't be approved or sent yet, in words; empty when it may go. The same
 * rules as the Writer: every claim cites a proven fact, no test score without a taken test, at
 * most two links, and cold mail only to a checked address.
 */
export function draftIssues(
  m: Pick<OutreachMessage, "channel" | "touch" | "subject" | "body" | "citations">,
  ctx: { facts: ProfileFact[]; applicant: Applicant | undefined; emailCheck: string },
) {
  const issues: string[] = [];
  if (unbackedScore(`${m.subject}\n${m.body}`, ctx.applicant))
    issues.push("claims a test score no taken test backs");
  for (const n of new Set([...m.body.matchAll(/\[(\d+)\]/g)].map((x) => x[1] ?? ""))) {
    const fact = ctx.facts.find((f) => f.id === m.citations[n]);
    if (!fact) issues.push(`[${n}] points at no fact`);
    else if (factStatus(fact) !== "confirmed") issues.push(`[${n}] cites a fact without proof`);
  }
  for (const claim of uncitedClaims(m.body))
    issues.push(`"${claim.length > 60 ? `${claim.slice(0, 57)}...` : claim}" cites no fact`);
  if ((m.body.match(/https?:\/\/\S+/g) ?? []).length > 2) issues.push("more than two links");
  const cold = m.touch !== "reply" && m.touch !== "thank-you";
  if (m.channel === "email" && cold && !addressChecked(ctx.emailCheck))
    issues.push("the address isn't checked yet: run Find and check emails");
  return issues;
}
