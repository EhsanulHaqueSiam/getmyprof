// Outreach: every message to or from a professor, by email or LinkedIn. The server stores
// messages; whose turn it is and the pipeline stage are derived from them, never stored.
import { z } from "zod";
import { Professor } from "./domain.ts";

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
  createdAt: z.string(),
});
export type OutreachMessage = z.infer<typeof OutreachMessage>;

/** Board columns. Applied and Offer join when applications land. */
export const PIPELINE_STAGES = ["to-contact", "contacted", "follow-up", "replied", "call"] as const;
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
  /** Why follow-ups stopped: a reply, a bounce, "not taking", or an out-of-office date. */
  stopped: z.string().nullable(),
  lastAt: z.string(),
});
export type Conversation = z.infer<typeof Conversation>;

/** The mailbox as the client sees it. The password never leaves the server. */
export const MailStatus = z.object({
  connected: z.boolean(),
  address: z.string(),
  name: z.string(),
  imapHost: z.string(),
  smtpHost: z.string(),
  /** Warm-up caps count weeks from here. */
  warmupStart: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  error: z.string(),
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
