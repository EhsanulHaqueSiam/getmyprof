// Outreach messages in the store, the rules a draft must pass, and where one professor stands.
// Stage and turn are derived from the messages on every read, so they never drift from what
// actually happened. pipeline.ts lists everyone; inbox.ts files synced mail.
import {
  type Channel,
  type Conversation,
  draftIssues,
  OutreachMessage,
  type Professor,
  Touch,
} from "@getmyprof/contracts";
import { profileFacts } from "../adapters.ts";
import { type Db, newId, now } from "../db.ts";
import { getRecord, putRecord } from "../records.ts";
import { getApplicant } from "../state.ts";
import { acceptedOffer, listDocuments, numberCitations } from "../vault.ts";
import { followUpDue, nextSlot, returnDate, workingTime } from "./plan.ts";

const parse = (r: Record<string, unknown>) => OutreachMessage.parse(JSON.parse(String(r.body)));
export const when = (m: OutreachMessage) => m.at ?? m.scheduledAt ?? m.createdAt;
const byTime = (a: OutreachMessage, b: OutreachMessage) => when(a).localeCompare(when(b));

export function putMessage(db: Db, m: OutreachMessage) {
  db.prepare(
    `INSERT INTO messages (id, record_key, status, message_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, message_id = excluded.message_id, body = excluded.body`,
  ).run(m.id, m.recordKey, m.status, m.messageId, JSON.stringify(m), m.createdAt);
  return m;
}

export function getMessage(db: Db, id: string) {
  const row = db.prepare("SELECT body FROM messages WHERE id = ?").get(id);
  return row ? parse(row) : null;
}

/** Messages oldest first, for one professor or everyone. */
export const listMessages = (db: Db, recordKey?: string) =>
  (recordKey
    ? db.prepare("SELECT body FROM messages WHERE record_key = ?").all(recordKey)
    : db.prepare("SELECT body FROM messages").all()
  )
    .map(parse)
    .toSorted(byTime);

export const setStage = (db: Db, record: Professor, stage: Professor["stage"]) =>
  putRecord(db, { ...record, stage, updatedAt: now() });

export type DraftInput = {
  recordKey: string;
  channel: Channel;
  touch: Touch;
  to: string;
  subject: string;
  body: string;
  timeZone: string;
  threadId: string | null;
  /** Vault document ids to send with it (email only), e.g. the CV they asked for. */
  attach?: string[] | undefined;
  /** Whose words it is (OutreachMessage.voice); "agent" when unsaid. */
  voice?: OutreachMessage["voice"] | undefined;
  /** What the agent changed in the applicant's own lines, and why. */
  fixes?: OutreachMessage["fixes"] | undefined;
};

const validZone = (timeZone: string) => {
  try {
    return Boolean(new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
};

export const isReply = (m: OutreachMessage) =>
  m.direction === "in" && (m.kind === "reply" || m.kind === "linkedin");

/**
 * Why a draft may not exist, or null. Each rule keeps a wrong email from reaching a real
 * person: only reviewed addresses, never apply-only, never twice, and never someone
 * gradhunt's outreach routine already owns.
 */
export function draftProblem(
  record: Professor | null,
  messages: OutreachMessage[],
  d: Pick<DraftInput, "channel" | "touch" | "to" | "body">,
): string | null {
  if (!record)
    return "they aren't in the sheet yet: propose them and wait for the applicant to accept";
  // A thank-you after an interview is never cold mail, so the cold-mail rules don't apply to it.
  const cold = d.touch !== "thank-you";
  if (cold && record.origin === "gradhunt")
    return "gradhunt's outreach routine owns this professor; draft there";
  if (cold && (record.stage === "apply-only" || /^apply-only/i.test(record.contact)))
    return "apply-only: they want an application, not an email";
  if (record.stage === "skip") return "marked skip";
  if (!d.body.trim()) return "the body is empty";
  if (d.channel === "email") {
    if (!record.email)
      return "no address in the sheet: record one with propose_professor and wait for review";
    if (d.to.trim().toLowerCase() !== record.email.toLowerCase())
      return `the sheet's address is ${record.email}; drafts only go to a reviewed address`;
    if (/bounce|invalid|undeliverable/i.test(record.emailCheck))
      return `the address failed its check (${record.emailCheck})`;
  } else if (!/^https:\/\/([a-z]+\.)?linkedin\.com\/in\//i.test(d.to.trim()))
    return "a LinkedIn note needs their profile URL (https://www.linkedin.com/in/...)";
  const s = standing(record, messages, new Date());
  if (d.touch === "first" && s.contacted && !s.bounced) return "already contacted";
  if (d.touch.startsWith("follow-up")) {
    if (!s.contacted) return "no first email went out yet";
    if (s.stopped) return `follow-ups stopped: ${s.stopped}`;
  }
  if (d.touch === "reply" && !messages.some(isReply)) return "they haven't written";
  return null;
}

/** Creates a draft, or rewrites the one already waiting for the same step. */
export function saveDraft(db: Db, d: DraftInput): OutreachMessage | { problem: string } {
  const record = getRecord(db, d.recordKey);
  const messages = listMessages(db, d.recordKey);
  const problem = draftProblem(record, messages, d);
  if (problem || !record) return { problem: problem ?? "no record" };
  const existing = messages.find(
    (m) => m.direction === "out" && m.status === "draft" && m.touch === d.touch,
  );
  // A rewrite keeps the files the waiting draft carried unless it names new ones.
  const attach = d.attach ?? existing?.attachments ?? [];
  if (attach.length && d.channel !== "email") return { problem: "only email carries attachments" };
  const docs = listDocuments(db);
  const unknown = attach.filter((id) => !docs.some((doc) => doc.id === id));
  if (unknown.length) return { problem: `no document ${unknown.join(", ")} in the vault` };
  const lastIn = messages.findLast(isReply);
  // Everything after the first email answers the latest real one (theirs or ours, never an
  // auto-reply), so both sides see one thread; a bare "Re:" that answers nothing looks like spam.
  const parent = messages.findLast(
    (m) =>
      m.channel === "email" &&
      m.messageId !== null &&
      (isReply(m) || (m.direction === "out" && m.status === "sent")),
  );
  const message: OutreachMessage = {
    id: existing?.id ?? newId("out"),
    recordKey: record.key,
    channel: d.channel,
    direction: "out",
    touch: d.touch,
    kind: null,
    replyClass: null,
    status: "draft",
    from: "",
    to: d.to.trim(),
    subject: d.subject.trim() || (lastIn ? `Re: ${lastIn.subject.replace(/^re:\s*/i, "")}` : ""),
    ...numberCitations(d.body.trim()),
    attachments: attach,
    timeZone: validZone(d.timeZone) ? d.timeZone : "America/New_York",
    scheduledAt: null,
    at: null,
    messageId: null,
    inReplyTo: d.channel === "email" && d.touch !== "first" ? (parent?.messageId ?? null) : null,
    threadId: d.threadId,
    note: "",
    voice: d.voice ?? "agent",
    // Their own lines stay with the draft through every rewrite.
    ownWords: existing?.ownWords ?? "",
    fixes: d.fixes ?? [],
    createdAt: existing?.createdAt ?? now(),
  };
  putMessage(db, message);
  if (record.stage === "new") setStage(db, record, "drafted");
  return message;
}

/** Mail to someone who hasn't written takes a send slot; answers and thank-yous skip the caps. */
const usesSlot = (m: OutreachMessage) =>
  m.channel === "email" && m.touch !== "reply" && m.touch !== "thank-you";

/** Slots already taken by scheduled or sent mail, for warm-up and per-university caps. */
function takenSlots(db: Db) {
  return listMessages(db)
    .filter((m) => usesSlot(m) && (m.status === "scheduled" || m.status === "sent"))
    .flatMap((m) => {
      const at = m.at ?? m.scheduledAt;
      const record = getRecord(db, m.recordKey);
      return at && record ? [{ at: new Date(at), university: record.university }] : [];
    });
}

/** Why this outgoing message can't be approved or sent yet (see draftIssues); empty when it may. */
export const issuesFor = (db: Db, m: OutreachMessage) =>
  draftIssues(m, {
    facts: profileFacts(db),
    applicant: getApplicant(db),
    record: getRecord(db, m.recordKey) ?? undefined,
  });

/**
 * Approves drafts (or failed sends, to retry): each gets its send time. A draft with an issue
 * (an unproven claim, an unbacked score, an unchecked address) is skipped, however it was
 * approved. Returns how many.
 */
export function approve(db: Db, ids: string[], at: Date, warmupStart: Date) {
  let n = 0;
  for (const id of ids) {
    const m = getMessage(db, id);
    const record = m && getRecord(db, m.recordKey);
    if (!m || !record || (m.status !== "draft" && m.status !== "failed")) continue;
    if (issuesFor(db, m).length) continue;
    const scheduledAt = usesSlot(m)
      ? nextSlot({
          now: at,
          timeZone: m.timeZone,
          university: record.university,
          scheduled: takenSlots(db),
          warmupStart,
        })
      : m.channel === "email"
        ? workingTime(at, m.timeZone)
        : at;
    putMessage(db, { ...m, status: "scheduled", scheduledAt: scheduledAt.toISOString(), note: "" });
    n++;
  }
  return n;
}

/** Scheduled email whose time has come. LinkedIn notes wait for the user to send them. */
export function dueToSend(db: Db, at: Date) {
  // Once an offer is accepted the hunt is over: answers and thank-yous still go, cold mail doesn't.
  const ended = acceptedOffer(db) !== null;
  return listMessages(db).filter(
    (m) =>
      m.status === "scheduled" &&
      m.channel === "email" &&
      m.scheduledAt !== null &&
      new Date(m.scheduledAt) <= at &&
      !(ended && m.touch !== "reply" && m.touch !== "thank-you"),
  );
}

/** Records a message as sent and moves the professor's stage along. */
export function markSent(db: Db, id: string, sent: { messageId: string | null; from: string }) {
  const m = getMessage(db, id);
  if (!m) return null;
  const next = putMessage(db, { ...m, status: "sent", at: now(), ...sent, note: "" });
  const record = getRecord(db, m.recordKey);
  if (record && m.touch === "first" && (record.stage === "new" || record.stage === "drafted"))
    setStage(db, record, "sent");
  return next;
}

/** What the rest of the hunt says about a professor, beyond their messages. */
export type Links = {
  /** A submitted application names them. */
  applied: boolean;
  /** That application's school made an offer. */
  offer: boolean;
  /** An offer was accepted somewhere: the hunt is over. */
  ended: boolean;
  followUpDays: readonly number[];
};
const NO_LINKS: Links = { applied: false, offer: false, ended: false, followUpDays: [7, 14] };

/**
 * Where a professor stands: from their messages, then what the hunt adds (an application that
 * names them, an offer, an accepted offer anywhere). Follow-ups run on the hunt's business days
 * after the first email, wait out an out-of-office, and stop on a reply, a bounce, applying, or
 * an accepted offer.
 */
export function standing(
  record: Professor,
  messages: OutreachMessage[],
  at: Date,
  links: Links = NO_LINKS,
) {
  const out = messages.filter((m) => m.direction === "out");
  const sent = out.filter((m) => m.status === "sent");
  const first = sent.findLast((m) => m.touch === "first");
  const incoming = messages.filter((m) => m.direction === "in");
  const replies = incoming.filter(isReply);
  const lastReply = replies.at(-1);
  const bounce = incoming.findLast((m) => m.kind === "bounce");
  // Ordering against our own sends uses when we received a message (createdAt, our clock),
  // not its Date header: another server's clock can run behind ours.
  const bounced = !!bounce && !!first && bounce.createdAt >= when(first) && !lastReply;
  const notTaking = replies.some((m) => m.replyClass === "not-taking");
  const stopped = notTaking
    ? "not taking students"
    : lastReply
      ? "they replied"
      : bounced
        ? "bounced"
        : links.ended
          ? "you accepted an offer"
          : links.applied
            ? "you applied and named them"
            : null;

  const away = incoming.findLast((m) => m.kind === "auto-reply");
  const back = away ? returnDate(away.body, new Date(when(away))) : null;
  const followUps = sent.filter((m) => m.touch?.startsWith("follow-up")).length;
  let followUpAt =
    !stopped && first?.at ? followUpDue(new Date(first.at), followUps, links.followUpDays) : null;
  if (followUpAt && back && back > followUpAt) followUpAt = back;

  const stage: Conversation["stage"] = notTaking
    ? "closed"
    : links.offer
      ? "offer"
      : links.applied
        ? "applied"
        : lastReply
          ? replies.some((m) => m.replyClass === "call")
            ? "call"
            : "replied"
          : bounced
            ? "to-contact"
            : first
              ? followUpAt && followUpAt <= at
                ? "follow-up"
                : "contacted"
              : record.stage === "replied"
                ? "replied"
                : record.stage === "sent"
                  ? "contacted"
                  : "to-contact";

  const last = messages.at(-1);
  const answered = !!lastReply && sent.some((m) => when(m) > lastReply.createdAt);
  const waiting = out.some((m) => m.status === "draft" || m.status === "failed");
  // After an accepted offer only warm mail (answers, thank-yous) still has somewhere to go.
  const waitingWarm = out.some(
    (m) =>
      (m.status === "draft" || m.status === "failed") &&
      (m.touch === "reply" || m.touch === "thank-you"),
  );
  const scheduled = out.some((m) => m.status === "scheduled");
  // Something approved and waiting for its slot needs nobody: it's queued.
  const turn: Conversation["turn"] =
    stage === "closed"
      ? "closed"
      : scheduled
        ? "queued"
        : (lastReply && !answered) || bounced
          ? "yours"
          : links.ended && !waitingWarm
            ? "closed"
            : stage === "follow-up"
              ? "follow-up"
              : waiting
                ? "approve"
                : stage === "to-contact" || stage === "offer"
                  ? "yours"
                  : "theirs";

  return {
    stage,
    turn,
    stopped,
    bounced,
    contacted: !!first,
    followUps,
    followUpAt: followUpAt?.toISOString() ?? null,
    lastAt: last ? when(last) : record.updatedAt,
  };
}
