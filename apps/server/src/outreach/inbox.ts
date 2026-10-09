// Filing synced mail: which professor a message is about, what kind it is, and what the agent
// read in a reply. Mail from anyone not contacted is ignored.
import { type OutreachMessage, type ReplyClass } from "@getmyprof/contracts";
import { type Db, newId, now } from "../db.ts";
import { getRecord, listRecords, putRecord } from "../records.ts";
import type { Incoming } from "./mail.ts";
import { classifyMail, returnDate } from "./plan.ts";
import { saveDocument } from "../vault.ts";
import { getMessage, listMessages, putMessage, setStage } from "./store.ts";

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
  // What they attached (a paper, a form, an offer letter) goes to the Vault's documents.
  const docs = (mail.attachments ?? []).map((f) =>
    saveDocument(db, {
      name: `${record.name}: ${f.filename}`,
      kind: "other",
      mime: f.mime,
      expires: null,
      base64: f.base64,
    }),
  );
  const message = putMessage(db, {
    id: newId("in"),
    recordKey: key,
    channel: kind === "linkedin" ? "linkedin" : "email",
    direction: "in",
    touch: null,
    kind,
    replyClass: null,
    status: "received",
    citations: {},
    voice: "agent",
    ownWords: "",
    fixes: [],
    attachments: docs.map((d) => d.id),
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

/** What a reply says about taking students, for the record's `taking` cell. */
const TAKING: Partial<Record<ReplyClass, string>> = {
  interested: "yes",
  call: "yes",
  "not-taking": "no",
};

/** The agent's reading of a reply: what they want, in one line. */
export function classify(db: Db, id: string, replyClass: ReplyClass, note: string) {
  const m = getMessage(db, id);
  if (!m || m.direction !== "in") return null;
  // What they said about taking students becomes the record, dated, over any earlier guess.
  const record = getRecord(db, m.recordKey);
  const taking = TAKING[replyClass];
  if (record && taking)
    putRecord(db, {
      ...record,
      taking: `${taking}, they replied ${(m.at ?? m.createdAt).slice(0, 10)}`,
      updatedAt: now(),
    });
  return putMessage(db, { ...m, replyClass, note });
}
