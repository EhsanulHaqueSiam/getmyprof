// Outreach as a running service: the mailbox login, the send worker, reply sync, and the agent
// turns that read replies and draft follow-ups. bin.ts ticks it; rpc.ts calls it.
import {
  type Application,
  type MailSignIn,
  MailStatus,
  OutreachMessage,
  addressChecked,
  Program,
  stripCitations,
} from "@gradcode/contracts";
import { z } from "zod";
import type { Runner } from "../agent/runner.ts";
import type { Bus } from "../bus.ts";
import { type Db, getKv, now, setKv } from "../db.ts";
import { getRecord, listRecords } from "../records.ts";
import { sameSchool } from "../sources.ts";
import { documentPath, listDocuments } from "../vault.ts";
import { createThread, getThread } from "../threads.ts";
import {
  Cursor,
  type MailConfig,
  type MailLogin,
  type Mailer,
  readMailConfig,
  removeMailConfig,
  saveMailConfig,
} from "./mail.ts";
import { finishSignIn, OAUTH_PROVIDERS, redirectUri, startSignIn } from "./oauth.ts";
import { ingest } from "./inbox.ts";
import { followUpsToDraft } from "./pipeline.ts";
import { dailyCap } from "./plan.ts";
import {
  approve,
  dueToSend,
  getMessage,
  issuesFor,
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

/**
 * Where the browser may come back to after a sign-in: this app's own pages only (loopback or the
 * tailnet), so the callback can't be used to bounce someone to another site.
 */
function safeReturn(returnTo: string) {
  try {
    const u = new URL(returnTo);
    const ours = ["127.0.0.1", "localhost"].includes(u.hostname) || u.hostname.endsWith(".ts.net");
    return ours && (u.protocol === "http:" || u.protocol === "https:") ? u.toString() : "";
  } catch {
    return "";
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export const FOLLOW_UP_TAG = "[follow-up]";
export const AFTER_APPLYING_TAG = "[after-applying]";
export const THANK_TAG = "[thank-you]";
export const REPLY_TAG = "[reply:";

export function createOutreach(deps: {
  db: Db;
  bus: Bus;
  runner: Pick<Runner, "send">;
  mailerFor: (c: MailLogin) => Mailer;
  /** Mailbox sign-in: this server's port for the OAuth callback, and the token endpoint to use. */
  signIn?: { port: number; tokenFetch: typeof fetch; scripted: boolean };
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
      via: config?.oauth?.provider ?? "password",
      address: config?.address ?? "",
      name: config?.name ?? "",
      imapHost: config?.imapHost ?? "",
      smtpHost: config?.smtpHost ?? "",
      warmupStart: config?.warmupStart ?? null,
      lastSyncAt: s.at,
      error: s.error,
      dailyCap: config ? dailyCap(new Date(config.warmupStart), new Date()) : 0,
    };
  }

  /** Verifies a login against both servers, then saves it. Warm-up keeps counting for the same box. */
  async function connect(input: MailLogin) {
    const mailer = mailerFor(input);
    await mailer.verify();
    const { cursor } = await mailer.fetchNew(null);
    const sameBox = config?.address === input.address;
    config = { ...input, warmupStart: sameBox && config ? config.warmupStart : now() };
    saveMailConfig(config);
    setKv(db, "mail.sync", { cursor, at: now(), error: "" });
    bus.push({ type: "changed", what: "state" });
    return status();
  }

  async function deliver(m: OutreachMessage, c: MailConfig) {
    try {
      const { messageId } = await mailerFor(c).send({
        from: { name: c.name, address: c.address },
        to: m.to,
        subject: m.subject,
        text: stripCitations(m.body),
        inReplyTo: m.inReplyTo,
        attachments: listDocuments(db).flatMap((doc) =>
          m.attachments.includes(doc.id)
            ? [{ filename: doc.name, path: documentPath(doc.id) }]
            : [],
        ),
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
        documentsLine(),
      ].join("\n"),
      "send",
      `${record.name} wrote back`,
    );
  }

  /** The vault documents a draft may attach (draft_email `attach`), e.g. the CV a professor asked for. */
  function documentsLine() {
    const docs = listDocuments(db);
    return docs.length
      ? `Documents you may attach with draft_email's attach, only when they asked: ${docs.map((d) => `${d.id} ${d.name} (${d.kind})`).join("; ")}.`
      : "";
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
    const lines = due.map((f) => {
      // A LinkedIn note that got no answer follows up by email when the sheet has a checked address.
      const byEmail =
        f.last?.channel === "linkedin" && !!f.record.email && addressChecked(f.record.emailCheck);
      const channel = byEmail ? "email" : (f.last?.channel ?? "email");
      const to = byEmail ? f.record.email : (f.last?.to ?? f.record.email);
      return `- ${f.record.name} | ${f.record.university} | key ${f.record.key} | ${f.touch} | channel ${channel} | to ${to} | zone ${f.last?.timeZone ?? "America/New_York"} | last message "${f.last?.subject ?? ""}": ${(f.last?.body ?? "").slice(0, 300)}`;
    });
    runner.send(
      t.id,
      `${FOLLOW_UP_TAG} keys=${due.map((f) => f.record.key).join(",")}\nNo reply yet from the professors below. Draft the follow-up named on each line with draft_email. Follow-up 1 is a short bump with a new angle (their latest paper); follow-up 2 is a last note offering a CV or a call. Keep the same subject with "Re: ". Use the channel on each line: a LinkedIn note with no reply moves to email.\n${lines.join("\n")}`,
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

    connect,

    /** The provider's consent page. The scripted stack skips it and calls its own callback. */
    startSignIn(input: MailSignIn) {
      const port = deps.signIn?.port ?? 4311;
      const url = startSignIn({ ...input, returnTo: safeReturn(input.returnTo) }, port);
      if (!deps.signIn?.scripted) return { url };
      const state = new URL(url).searchParams.get("state") ?? "";
      return { url: `${redirectUri(input.provider, port)}?state=${state}&code=scripted` };
    },

    /** The callback: trades the code, connects the mailbox, and says where the browser goes. */
    async finishSignIn(state: string, code: string) {
      const done = await finishSignIn(state, code, deps.signIn?.tokenFetch ?? fetch);
      const p = OAUTH_PROVIDERS[done.oauth.provider];
      await connect({
        name: done.name,
        address: done.address,
        password: "",
        imapHost: p.imap.host,
        imapPort: p.imap.port,
        smtpHost: p.smtp.host,
        smtpPort: p.smtp.port,
        oauth: done.oauth,
      });
      return done.returnTo;
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

    /** After an interview, the agent drafts a thank-you to that professor into the Pipeline. */
    thank(interviewee: string, university: string) {
      const last = interviewee.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
      const record = listRecords(db).find(
        (r) => r.name.toLowerCase().includes(last) && sameSchool(r.university, university),
      );
      if (!record?.email)
        throw new Error(
          `${interviewee} has no reviewed email in the sheet, so there's no one to thank.`,
        );
      const zone =
        listMessages(db, record.key).find((m) => m.direction === "out" && m.timeZone)?.timeZone ??
        "America/New_York";
      const t = createThread(db, `Thank-you · ${record.name}`);
      runner.send(
        t.id,
        `${THANK_TAG}\nThe applicant just interviewed with ${record.name}. Draft a short thank-you with draft_email (touch thank-you): thank them for their time and name one thing from the conversation only if the applicant told you one.\n- ${record.name} | ${record.university} | key ${record.key} | to ${record.email} | zone ${zone}`,
        "send",
        `Draft a thank-you to ${record.name}`,
      );
      return t.id;
    },

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
        `${AFTER_APPLYING_TAG} app=${app.id}\nThe applicant submitted their application to ${program.name} at ${program.university} and named the professors below.${app.applicationId ? ` The application ID is ${app.applicationId}; quote it.` : ""} Draft a short note to each with draft_email (touch after-applying): they applied to that program and named them. Skip anyone apply-only.\n${lines.join("\n")}`,
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
      const issues = issuesFor(db, m);
      if (issues.length) throw new Error(`Not yet: ${issues.join("; ")}.`);
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
      if (!m || m.direction !== "out" || m.status === "sent" || m.status === "cancelled")
        throw new Error("Only a waiting message is marked sent by hand.");
      markSent(db, id, { messageId: null, from: "linkedin" });
      changed();
    },
  };
}

export type Outreach = ReturnType<typeof createOutreach>;
