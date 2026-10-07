// The mailbox: the login saved 0600 under GRADCODE_HOME, a real mailer over IMAP and SMTP with
// an app password, and a scripted one for tests and e2e. Only outreach/service.ts uses a Mailer.
import { MailConnect } from "@gradcode/contracts";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import nodemailer from "nodemailer";
import { z } from "zod";
import { homeDir } from "../db.ts";

export const MailConfig = MailConnect.extend({ warmupStart: z.string() });
export type MailConfig = z.infer<typeof MailConfig>;

const configPath = () => NodePath.join(homeDir(), "mail.json");

export function readMailConfig(): MailConfig | null {
  try {
    return MailConfig.parse(JSON.parse(NodeFS.readFileSync(configPath(), "utf8")));
  } catch {
    return null;
  }
}

/** Saves the login readable by this user only. */
export function saveMailConfig(config: MailConfig) {
  NodeFS.mkdirSync(NodePath.dirname(configPath()), { recursive: true });
  NodeFS.writeFileSync(configPath(), JSON.stringify(config), { mode: 0o600 });
  NodeFS.chmodSync(configPath(), 0o600);
}

export const removeMailConfig = () => NodeFS.rmSync(configPath(), { force: true });

export type Outgoing = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
};

export type Incoming = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  subject: string;
  text: string;
  date: string;
};

/** Where the last sync stopped. A new UIDVALIDITY means the mailbox was rebuilt: start over. */
export const Cursor = z.object({ uidValidity: z.string(), lastUid: z.number() });
export type Cursor = z.infer<typeof Cursor>;

export type Mailer = {
  /** Logs in to both servers; throws with the server's reason. */
  verify(): Promise<void>;
  send(m: Outgoing): Promise<{ messageId: string }>;
  /** INBOX messages after the cursor. With no cursor it only marks where to start: history stays out. */
  fetchNew(cursor: Cursor | null): Promise<{ cursor: Cursor; messages: Incoming[] }>;
};

const smtp = (c: MailConnect) =>
  nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    // 465 is TLS from the start; 587 upgrades with STARTTLS.
    secure: c.smtpPort === 465,
    auth: { user: c.address, pass: c.password },
  });

const imap = (c: MailConnect) =>
  new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapPort === 993,
    auth: { user: c.address, pass: c.password },
    logger: false,
  });

const ids = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(/\s+/) : []);

export function imapMailer(c: MailConnect): Mailer {
  return {
    async verify() {
      await smtp(c).verify();
      const client = imap(c);
      await client.connect();
      await client.logout();
    },
    async send(m) {
      const info = await smtp(c).sendMail({
        from: m.from,
        to: m.to,
        subject: m.subject,
        text: m.text,
        ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: [m.inReplyTo] } : {}),
      });
      return { messageId: info.messageId };
    },
    async fetchNew(cursor) {
      const client = imap(c);
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const box = client.mailbox;
        if (!box) throw new Error("INBOX did not open");
        const uidValidity = String(box.uidValidity);
        const newest = box.uidNext - 1;
        if (!cursor || cursor.uidValidity !== uidValidity)
          return { cursor: { uidValidity, lastUid: newest }, messages: [] };
        const messages: Incoming[] = [];
        let lastUid = cursor.lastUid;
        if (newest > cursor.lastUid)
          for await (const msg of client.fetch(
            `${cursor.lastUid + 1}:*`,
            { uid: true, source: true },
            { uid: true },
          )) {
            // "n:*" always returns the newest message, even when it is older than n.
            if (msg.uid <= cursor.lastUid || !msg.source) continue;
            lastUid = Math.max(lastUid, msg.uid);
            const p = await simpleParser(msg.source);
            messages.push({
              messageId: p.messageId ?? null,
              inReplyTo: p.inReplyTo ?? null,
              references: ids(p.references),
              from: p.from?.value[0]?.address ?? p.from?.text ?? "",
              subject: p.subject ?? "",
              text: p.text ?? "",
              date: (p.date ?? new Date()).toISOString(),
            });
          }
        return { cursor: { uidValidity, lastUid }, messages };
      } finally {
        lock.release();
        await client.logout();
      }
    },
  };
}

/**
 * A mailbox that never touches the network (GRADCODE_AGENT=fake, tests). Sends are kept in
 * `sent`; fixture professors answer on the next sync: Lybarger asks for a CV, Zalake is away.
 */
export function fakeMailer() {
  const sent: Outgoing[] = [];
  const inbox: (Incoming & { uid: number })[] = [];
  let uid = 0;
  const reply = (inReplyTo: string, from: string, subject: string, text: string) =>
    inbox.push({
      uid: ++uid,
      messageId: `<fake-in-${uid}@example.edu>`,
      inReplyTo,
      references: [inReplyTo],
      from,
      subject,
      text,
      date: new Date().toISOString(),
    });

  const mailer: Mailer & { sent: Outgoing[] } = {
    sent,
    verify: async () => {},
    async send(m) {
      const messageId = `<fake-out-${++uid}@gradcode.test>`;
      sent.push(m);
      if (m.to === "lybarger@example.edu")
        reply(
          messageId,
          m.to,
          `Re: ${m.subject}`,
          "Thanks for reaching out. Could you send your CV and a short note on what you'd want to work on in clinical NLP?",
        );
      if (m.to === "zalake@example.edu") {
        const back = new Date(Date.now() + 10 * 864e5).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        reply(
          messageId,
          m.to,
          `Automatic reply: ${m.subject}`,
          `I am out of the office until ${back} with limited access to email.`,
        );
      }
      return { messageId };
    },
    async fetchNew(cursor) {
      const newest = inbox.at(-1)?.uid ?? 0;
      if (!cursor) return { cursor: { uidValidity: "fake", lastUid: newest }, messages: [] };
      return {
        cursor: { uidValidity: "fake", lastUid: Math.max(cursor.lastUid, newest) },
        messages: inbox.filter((m) => m.uid > cursor.lastUid),
      };
    },
  };
  return mailer;
}
