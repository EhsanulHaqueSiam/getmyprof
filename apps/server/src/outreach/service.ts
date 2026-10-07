// Outreach as a running service: the mailbox login, the send worker, reply sync, and the agent
// turns that read replies and draft follow-ups. bin.ts ticks it; rpc.ts calls it.
import type {
  Application,
  MailConnect,
  MailStatus,
  OutreachMessage,
  Program,
} from "@gradcode/contracts";
import { z } from "zod";
import type { Runner } from "../agent/runner.ts";
import type { Bus } from "../bus.ts";
import { type Db, getKv, now, setKv } from "../db.ts";
import { getRecord } from "../records.ts";
import { createThread, getThread } from "../threads.ts";
import {
  Cursor,
  type MailConfig,
  type Mailer,
  readMailConfig,
  removeMailConfig,
  saveMailConfig,
} from "./mail.ts";
import {
  approve,
  dueToSend,
  followUpsToDraft,
  getMessage,
  ingest,
  listMessages,
  markSent,
  putMessage,
} from "./store.ts";

const SyncState = z.object({
  cursor: Cursor.nullable(),
  at: z.string().nullable(),
  error: z.string(),
});
const NEVER_SYNCED = { cursor: null, at: null, error: "" };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export const FOLLOW_UP_TAG = "[follow-up]";
export const AFTER_APPLYING_TAG = "[after-applying]";
export const REPLY_TAG = "[reply:";

export function createOutreach(deps: {
  db: Db;
  bus: Bus;
  runner: Pick<Runner, "send">;
  mailerFor: (c: MailConnect) => Mailer;
}) {
  const { db, bus, runner, mailerFor } = deps;
  let config: MailConfig | null = readMailConfig();
  let sending = false;

  const syncState = () => getKv(db, "mail.sync", (v) => SyncState.parse(v), NEVER_SYNCED);
  const changed = () => {
    bus.push({ type: "changed", what: "outreach" });
    bus.push({ type: "changed", what: "records" });
  };
  const connected = () => {
    if (!config) throw new Error("Connect a mailbox in Settings first.");
    return config;
  };

  function status(): MailStatus {
    const s = syncState();
    return {
      connected: config !== null,
      address: config?.address ?? "",
      name: config?.name ?? "",
      imapHost: config?.imapHost ?? "",
      smtpHost: config?.smtpHost ?? "",
      warmupStart: config?.warmupStart ?? null,
      lastSyncAt: s.at,
      error: s.error,
    };
  }

  async function deliver(m: OutreachMessage, c: MailConfig) {
    try {
      const { messageId } = await mailerFor(c).send({
        from: { name: c.name, address: c.address },
        to: m.to,
        subject: m.subject,
        text: m.body,
        inReplyTo: m.inReplyTo,
      });
      markSent(db, m.id, { messageId, from: c.address });
    } catch (e) {
      putMessage(db, { ...m, status: "failed", note: errorText(e) });
    }
    changed();
  }

  /** A reply goes back to the thread that wrote the first email, so the agent has the context. */
  function askAboutReply(m: OutreachMessage) {
    const record = getRecord(db, m.recordKey);
    if (!record) return;
    const origin = listMessages(db, m.recordKey).find(
      (x) => x.direction === "out" && x.threadId && getThread(db, x.threadId),
    );
    const threadId = origin?.threadId ?? createThread(db, `Reply · ${record.name}`).id;
    runner.send(
      threadId,
      [
        `${REPLY_TAG}${m.id}] ${record.name} (${record.university}) wrote back${m.channel === "linkedin" ? " on LinkedIn" : ""}.`,
        `Subject: ${m.subject}`,
        `"""\n${m.body.slice(0, 4000)}\n"""`,
        `Classify it with classify_reply (message id ${m.id}), then draft the answer with draft_email (touch reply, channel ${m.channel}). If they ask for something only the applicant can provide, say so in your reply instead of inventing it.`,
      ].join("\n"),
      "send",
      `${record.name} wrote back`,
    );
  }

  /** One thread drafts every follow-up that came due, once per step. */
  function draftFollowUps(at: Date) {
    const asked = new Set(getKv(db, "outreach.asked", (v) => z.array(z.string()).parse(v), []));
    const due = followUpsToDraft(db, at).filter((f) => !asked.has(`${f.record.key}:${f.touch}`));
    if (due.length === 0) return;
    for (const f of due) asked.add(`${f.record.key}:${f.touch}`);
    setKv(db, "outreach.asked", [...asked]);
    const t = createThread(
      db,
      `Follow-ups · ${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    );
    const lines = due.map(
      (f) =>
        `- ${f.record.name} | ${f.record.university} | key ${f.record.key} | ${f.touch} | to ${f.last?.to ?? f.record.email} | zone ${f.last?.timeZone ?? "America/New_York"} | last email "${f.last?.subject ?? ""}": ${(f.last?.body ?? "").slice(0, 300)}`,
    );
    runner.send(
      t.id,
      `${FOLLOW_UP_TAG} keys=${due.map((f) => f.record.key).join(",")}\nNo reply yet from the professors below. Draft the follow-up named on each line with draft_email. Follow-up 1 is a short bump with a new angle (their latest paper); follow-up 2 is a last note offering a CV or a call. Keep the same subject with "Re: ".\n${lines.join("\n")}`,
      "send",
      `Draft ${due.length} follow-up${due.length === 1 ? "" : "s"}`,
    );
  }

  /**
   * Asks for follow-ups that came due, then sends everything due, one message at a time. Every
   * send goes through here, so a message can never go out twice.
   */
  async function tick(at = new Date()) {
    draftFollowUps(at);
    if (!config || sending) return;
    sending = true;
    try {
      for (let next = dueToSend(db, at)[0]; next; next = dueToSend(db, at)[0])
        await deliver(next, config);
    } finally {
      sending = false;
    }
  }

  return {
    status,

    async connect(input: MailConnect) {
      const mailer = mailerFor(input);
      await mailer.verify();
      const { cursor } = await mailer.fetchNew(null);
      const sameBox = config?.address === input.address;
      config = { ...input, warmupStart: sameBox && config ? config.warmupStart : now() };
      saveMailConfig(config);
      setKv(db, "mail.sync", { cursor, at: now(), error: "" });
      bus.push({ type: "changed", what: "state" });
      return status();
    },

    disconnect() {
      removeMailConfig();
      config = null;
      setKv(db, "mail.sync", NEVER_SYNCED);
      bus.push({ type: "changed", what: "state" });
      return status();
    },

    /** Pulls new INBOX mail, files outreach replies, and hands real replies to the agent. */
    async sync() {
      if (!config) return status();
      const before = syncState();
      try {
        const { cursor, messages } = await mailerFor(config).fetchNew(before.cursor);
        const filed = messages.flatMap((m) => ingest(db, m) ?? []);
        setKv(db, "mail.sync", { cursor, at: now(), error: "" });
        for (const m of filed) if (m.kind === "reply" || m.kind === "linkedin") askAboutReply(m);
        if (filed.length) changed();
      } catch (e) {
        setKv(db, "mail.sync", { ...before, error: errorText(e) });
      }
      bus.push({ type: "changed", what: "state" });
      return status();
    },

    tick,

    /** Once an application is in, the agent drafts "I applied and named you" to each named professor. */
    afterApplying(app: Application, program: Program) {
      const named = app.professors.flatMap((key) => {
        const r = getRecord(db, key);
        return r && r.email && r.origin === "app" ? [r] : [];
      });
      if (named.length === 0) return;
      const lines = named.map((r) => {
        const zone =
          listMessages(db, r.key).find((m) => m.direction === "out" && m.timeZone)?.timeZone ??
          "America/New_York";
        return `- ${r.name} | ${r.university} | key ${r.key} | to ${r.email} | zone ${zone}`;
      });
      const t = createThread(db, `Applied · ${program.university}`);
      runner.send(
        t.id,
        `${AFTER_APPLYING_TAG} app=${app.id}\nThe applicant submitted their application to ${program.name} at ${program.university} and named the professors below. Draft a short note to each with draft_email (touch after-applying): they applied to that program and named them. Skip anyone apply-only.\n${lines.join("\n")}`,
        "send",
        `Draft ${named.length} "I applied" note${named.length === 1 ? "" : "s"}`,
      );
    },

    async approve(ids: string[]) {
      const c = connected();
      approve(db, ids, new Date(), new Date(c.warmupStart));
      changed();
      await tick();
    },

    async sendNow(id: string) {
      connected();
      const m = getMessage(db, id);
      if (!m || m.channel !== "email" || !["draft", "scheduled", "failed"].includes(m.status))
        throw new Error("Only a waiting email can be sent now.");
      putMessage(db, { ...m, status: "scheduled", scheduledAt: now() });
      await tick();
    },

    edit(id: string, subject: string, body: string) {
      const m = getMessage(db, id);
      if (!m || !["draft", "scheduled", "failed"].includes(m.status))
        throw new Error("Only a message that hasn't gone out can change.");
      putMessage(db, { ...m, subject, body });
      changed();
    },

    cancel(id: string) {
      const m = getMessage(db, id);
      if (!m || !["draft", "scheduled", "failed"].includes(m.status))
        throw new Error("Only a message that hasn't gone out can be cancelled.");
      putMessage(db, { ...m, status: "cancelled" });
      changed();
    },

    markSent(id: string) {
      const m = getMessage(db, id);
      if (!m || m.channel !== "linkedin" || m.status === "sent" || m.status === "cancelled")
        throw new Error("Only a waiting LinkedIn note is marked sent by hand.");
      markSent(db, id, { messageId: null, from: "linkedin" });
      changed();
    },
  };
}

export type Outreach = ReturnType<typeof createOutreach>;
