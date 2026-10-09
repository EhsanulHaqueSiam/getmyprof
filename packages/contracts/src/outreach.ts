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
  stripCitations,
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

/** Mailboxes that sign in with OAuth instead of an app password. */
export const MailProvider = z.enum(["google", "microsoft"]);
export type MailProvider = z.infer<typeof MailProvider>;

/**
 * Starts a mailbox sign-in. An empty `clientId` uses getmyprof's own client for the provider;
 * a user can bring theirs instead. `returnTo` is the Settings page the browser comes back to.
 */
export const MailSignIn = z.object({
  provider: MailProvider,
  clientId: z.string(),
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
  /** The login stopped working (sign-in ended, app password revoked): sign in again. */
  signedOut: z.boolean(),
  /** How many first emails and follow-ups may go out today under the warm-up. */
  dailyCap: z.number(),
  /** Providers getmyprof has its own OAuth client for: signing in needs no setup. */
  sharedClients: z.array(MailProvider),
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

// What makes a first message read as mass mail: faculty get dozens a day and skip these.
const GENERIC_SALUTATION =
  /\bdear\s+(?:sir|madam)s?\b|\bsir\s*\/\s*madam|\brespected\s+(?:sir|madam|professor)\b|\bto whom it may concern|\bdear\s+(?:professor|prof\.?|dr\.?)\s*(?:,|$)/im;
const GENERIC_LINES = [
  /\bfind your (?:research|work) (?:very |truly |really )?(?:fascinating|interesting|inspiring|impressive|intriguing)/i,
  /\byour (?:research|work) is (?:very |truly |really )?(?:fascinating|interesting|inspiring|impressive|intriguing)/i,
  /\b(?:fascinated|impressed|inspired) by your (?:research|work)\b/i,
  /\byour esteemed \w+/i,
  /\bI came across your (?:profile|website|page)/i,
  /\bI am writing to express my (?:keen |strong )?interest/i,
  /\bI hope this (?:e-?mail|message) finds you well/i,
  /\bgreetings of the day/i,
  /\bI humbly request/i,
  /\bkindly consider/i,
  /\bhighly motivated/i,
  /\bhard[- ]?working/i,
  /\bit would be an hono(?:u)?r/i,
];
// Subject words that say nothing on their own: "PhD inquiry", "Prospective student, Fall 2027".
const BARE_SUBJECT =
  /^(?:ph|d|phd|doctoral|inquiry|enquiry|query|position|positions|opening|request|for|a|an|the|admission|admissions|application|prospective|student|students|opportunity|regarding|re|in|your|lab|group|research|fall|spring|autumn|winter|summer|intake|funded|\d+)$/;
const STOP = new Set(
  "a an the of for and or in on with to by from at via using as is are its into toward towards".split(
    " ",
  ),
);
/** Lowercased words with punctuation and filler dropped: "Query-Aware RAG" reads "query aware rag". */
const significant = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w));
/** The titles in a record's recent line: "2026-08 Title (Venue); 2025 Other" as two titles. */
export const recentTitles = (recent: string) =>
  recent
    .split(";")
    .map((t) =>
      t
        .trim()
        .replace(/^\d{4}(?:-\d{2}){0,2}\s+/, "")
        .replace(/\s*\([^)]*\)$/, ""),
    )
    .filter(Boolean);
/** Whether a body names one of these works: 3 of a title's words in a row, or a quoted 4+ words. */
function namesWork(body: string, works: string[]) {
  if (/["“]\s*(?:[^"”\s]+\s+){3,}[^"”\s]+\s*["”]/.test(body)) return true;
  const said = ` ${significant(body).join(" ")} `;
  return works.some((t) => {
    const w = significant(t);
    const n = Math.min(3, w.length);
    return w.some((_, i) => i + n <= w.length && said.includes(` ${w.slice(i, i + n).join(" ")} `));
  });
}

/**
 * What keeps a first message from reading as written for this one professor: a generic
 * salutation or line, and for email a long body, a vague subject, or no paper of theirs named.
 * Their `recent` titles and their `hook` are what a body may name.
 */
function personalIssues(
  m: Pick<OutreachMessage, "channel" | "subject" | "body">,
  record: Pick<Professor, "recent" | "hook"> | undefined,
) {
  const issues: string[] = [];
  const body = stripCitations(m.body);
  if (GENERIC_SALUTATION.test(body))
    issues.push('generic salutation: write "Dear Professor <Surname>" or "Dr. <Surname>"');
  for (const line of GENERIC_LINES) {
    const found = line.exec(body)?.[0];
    if (found) issues.push(`generic: "${found}": say what in their work, specifically`);
  }
  if (m.channel !== "email") return issues;
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > 150) issues.push(`${words} words: keep a first email under 150`);
  const subject = m.subject.split(/\s+/).filter(Boolean).length;
  const bare = significant(m.subject).every((w) => BARE_SUBJECT.test(w));
  if (!subject || subject > 12 || bare)
    issues.push(
      `${!subject ? "no subject" : subject > 12 ? `a ${subject}-word subject` : "a generic subject"}: name the topic and intake in 3 to 7 words`,
    );
  const works = [...recentTitles(record?.recent ?? ""), record?.hook ?? ""].filter(Boolean);
  if (!works.length)
    issues.push("nothing of theirs on file to name: run Recent work and focus first");
  else if (!namesWork(body, works))
    issues.push("doesn't name a paper of theirs: cite one recent work by title");
  return issues;
}

/**
 * What the applicant did since a message went out (its ISO date): confirmed facts dated to the
 * day after it. A follow-up's honest new angle; a fact dated only "2026" can't be placed after a
 * day, so it doesn't count.
 */
export const factsSince = (facts: ProfileFact[], sent: string) =>
  facts.filter((f) => factStatus(f) === "confirmed" && f.date.length >= 10 && f.date > sent);

/** The opening line of a message, past the greeting, without citation markers: what it says. */
export const gist = (body: string) =>
  stripCitations(body)
    .split(/\n+/)
    .map((l) => l.trim())
    .find((l) => l && !/^(?:dear|hi|hello)\b/i.test(l)) ?? "";

/**
 * Why an outgoing message can't be approved or sent yet, in words; empty when it may go. The same
 * rules as the Writer: every claim cites a proven fact, no test score without a taken test, at
 * most two links, and cold mail only to a checked address. A first message must also read as
 * written for this professor (see personalIssues).
 */
export function draftIssues(
  m: Pick<OutreachMessage, "channel" | "touch" | "subject" | "body" | "citations">,
  ctx: {
    facts: ProfileFact[];
    applicant: Applicant | undefined;
    /** The professor it goes to; a message to no one in the sheet has no checked address. */
    record: Pick<Professor, "emailCheck" | "recent" | "hook"> | undefined;
  },
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
  // Not connected yet, it goes as a connection request's note: 200 characters on a free account.
  if (m.channel === "linkedin" && m.touch === "first" && stripCitations(m.body).trim().length > 200)
    issues.push("a first LinkedIn note over 200 characters won't fit a connection request");
  const cold = m.touch !== "reply" && m.touch !== "thank-you";
  if (m.channel === "email" && cold && !addressChecked(ctx.record?.emailCheck ?? ""))
    issues.push("the address isn't checked yet: run Find and check emails");
  if (m.touch === "first") issues.push(...personalIssues(m, ctx.record));
  return issues;
}
