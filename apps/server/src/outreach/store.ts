// Outreach messages in the store, the rules a draft must pass, and where each professor stands.
// Stage and turn are derived from the messages on every read, so they never drift from what
// actually happened.
import {
  type Channel,
  type Conversation,
  OutreachMessage,
  type Professor,
  type ReplyClass,
  Touch,
  unbackedScore,
} from "@gradcode/contracts";
import { type Db, newId, now } from "../db.ts";
import { getRecord, listRecords, putRecord } from "../records.ts";
import { getApplicant } from "../state.ts";
import type { Incoming } from "./mail.ts";
import { classifyMail, followUpDue, nextSlot, returnDate } from "./plan.ts";

const parse = (r: Record<string, unknown>) => OutreachMessage.parse(JSON.parse(String(r.body)));
const when = (m: OutreachMessage) => m.at ?? m.scheduledAt ?? m.createdAt;
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

const setStage = (db: Db, record: Professor, stage: Professor["stage"]) =>
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
};

const validZone = (timeZone: string) => {
  try {
    return Boolean(new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
};

const isReply = (m: OutreachMessage) =>
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
  const lastIn = messages.findLast(isReply);
  const existing = messages.find(
    (m) => m.direction === "out" && m.status === "draft" && m.touch === d.touch,
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
    body: d.body.trim(),
    timeZone: validZone(d.timeZone) ? d.timeZone : "America/New_York",
    scheduledAt: null,
    at: null,
    messageId: null,
    inReplyTo: d.touch === "reply" ? (lastIn?.messageId ?? null) : null,
    threadId: d.threadId,
    note: "",
    createdAt: existing?.createdAt ?? now(),
  };
  putMessage(db, message);
  if (record.stage === "new") setStage(db, record, "drafted");
  return message;
}

/** Mail to someone who hasn't written takes a send slot; answers and thank-yous go at once. */
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

/**
 * Approves drafts (or failed sends, to retry): each gets its send time. A draft that claims a
 * test score no taken test backs is skipped, however it was approved. Returns how many.
 */
export function approve(db: Db, ids: string[], at: Date, warmupStart: Date) {
  let n = 0;
  const applicant = getApplicant(db);
  for (const id of ids) {
    const m = getMessage(db, id);
    const record = m && getRecord(db, m.recordKey);
    if (!m || !record || (m.status !== "draft" && m.status !== "failed")) continue;
    if (unbackedScore(`${m.subject}\n${m.body}`, applicant)) continue;
    const scheduledAt = usesSlot(m)
      ? nextSlot({
          now: at,
          timeZone: m.timeZone,
          university: record.university,
          scheduled: takenSlots(db),
          warmupStart,
        })
      : at;
    putMessage(db, { ...m, status: "scheduled", scheduledAt: scheduledAt.toISOString(), note: "" });
    n++;
  }
  return n;
}

/** Scheduled email whose time has come. LinkedIn notes wait for the user to send them. */
export const dueToSend = (db: Db, at: Date) =>
  listMessages(db).filter(
    (m) =>
      m.status === "scheduled" &&
      m.channel === "email" &&
      m.scheduledAt !== null &&
      new Date(m.scheduledAt) <= at,
  );

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

/** Which professor an incoming message is about. Mail from anyone not contacted is ignored. */
function matchRecord(db: Db, mail: Incoming, kind: OutreachMessage["kind"]) {
  const sent = listMessages(db).filter((m) => m.direction === "out" && m.status === "sent");
  const refs = new Set([mail.inReplyTo, ...mail.references]);
  const byRef = sent.find((m) => m.messageId && refs.has(m.messageId));
  if (byRef) return byRef.recordKey;
  const contacted = listRecords(db).filter((r) => sent.some((m) => m.recordKey === r.key));
  if (kind === "bounce") {
    const text = mail.text.toLowerCase();
    return (
      sent.find(
        (m) =>
          m.channel === "email" &&
          ((m.messageId && mail.text.includes(m.messageId)) || text.includes(m.to.toLowerCase())),
      )?.recordKey ?? null
    );
  }
  if (kind === "linkedin") {
    const hay = `${mail.subject}\n${mail.text}`.toLowerCase();
    return contacted.find((r) => hay.includes(r.name.toLowerCase()))?.key ?? null;
  }
  const from = mail.from.toLowerCase();
  return contacted.find((r) => r.email && r.email.toLowerCase() === from)?.key ?? null;
}

/** Files one synced message under its professor. Returns it, or null when it isn't outreach. */
export function ingest(db: Db, mail: Incoming): OutreachMessage | null {
  if (
    mail.messageId &&
    db.prepare("SELECT 1 FROM messages WHERE message_id = ?").get(mail.messageId)
  )
    return null;
  const kind = classifyMail({ from: mail.from, subject: mail.subject, body: mail.text });
  const key = matchRecord(db, mail, kind);
  const record = key ? getRecord(db, key) : null;
  if (!key || !record) return null;
  const back = kind === "auto-reply" ? returnDate(mail.text, new Date(mail.date)) : null;
  const message = putMessage(db, {
    id: newId("in"),
    recordKey: key,
    channel: kind === "linkedin" ? "linkedin" : "email",
    direction: "in",
    touch: null,
    kind,
    replyClass: null,
    status: "received",
    from: mail.from,
    to: "",
    subject: mail.subject,
    body: mail.text.slice(0, 20_000),
    timeZone: "",
    scheduledAt: null,
    at: mail.date,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    threadId: null,
    note: back
      ? `away until ${back.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
      : "",
    createdAt: now(),
  });
  if ((kind === "reply" || kind === "linkedin") && record.stage !== "replied")
    setStage(db, record, "replied");
  if (kind === "bounce")
    putRecord(db, { ...record, emailCheck: `bounced ${mail.date.slice(0, 10)}`, updatedAt: now() });
  return message;
}

/** The agent's reading of a reply: what they want, in one line. */
export function classify(db: Db, id: string, replyClass: ReplyClass, note: string) {
  const m = getMessage(db, id);
  if (!m || m.direction !== "in") return null;
  return putMessage(db, { ...m, replyClass, note });
}

/**
 * Where a professor stands, from their messages alone. Follow-ups run +7 and +14 business days
 * after the first email, wait out an out-of-office, and stop on any reply or bounce.
 */
export function standing(record: Professor, messages: OutreachMessage[], at: Date) {
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
        : null;

  const away = incoming.findLast((m) => m.kind === "auto-reply");
  const back = away ? returnDate(away.body, new Date(when(away))) : null;
  const followUps = sent.filter((m) => m.touch?.startsWith("follow-up")).length;
  let followUpAt = !stopped && first?.at ? followUpDue(new Date(first.at), followUps) : null;
  if (followUpAt && back && back > followUpAt) followUpAt = back;

  const stage: Conversation["stage"] = notTaking
    ? "closed"
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
  const scheduled = out.some((m) => m.status === "scheduled");
  // Something approved and waiting for its slot needs nobody: it's queued.
  const turn: Conversation["turn"] =
    stage === "closed"
      ? "closed"
      : scheduled
        ? "queued"
        : (lastReply && !answered) || bounced
          ? "yours"
          : stage === "follow-up"
            ? "follow-up"
            : waiting
              ? "approve"
              : stage === "to-contact"
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

/** Everyone in the pipeline: anyone with outreach, or an app record already past "new". */
export function conversations(db: Db, at = new Date()): Conversation[] {
  const all = listMessages(db);
  return listRecords(db)
    .flatMap((record) => {
      const messages = all.filter((m) => m.recordKey === record.key);
      const inPlay =
        messages.length > 0 ||
        (record.origin === "app" && ["drafted", "sent", "replied"].includes(record.stage));
      if (!inPlay) return [];
      const s = standing(record, messages, at);
      return [
        {
          record,
          messages,
          stage: s.stage,
          turn: s.turn,
          followUpAt: s.followUpAt,
          stopped: s.stopped,
          lastAt: s.lastAt,
        },
      ];
    })
    .toSorted((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Follow-ups due now with no draft yet, and which step each one is. */
export function followUpsToDraft(db: Db, at = new Date()) {
  return conversations(db, at).flatMap((c) => {
    if (c.stage !== "follow-up") return [];
    const sent = c.messages.filter((m) => m.direction === "out" && m.status === "sent");
    const step = Touch.safeParse(
      `follow-up-${sent.filter((m) => m.touch?.startsWith("follow-up")).length + 1}`,
    );
    if (!step.success) return [];
    const touch = step.data;
    const drafted = c.messages.some(
      (m) => m.direction === "out" && m.touch === touch && m.status !== "cancelled",
    );
    return drafted ? [] : [{ record: c.record, touch, last: sent.at(-1) }];
  });
}
