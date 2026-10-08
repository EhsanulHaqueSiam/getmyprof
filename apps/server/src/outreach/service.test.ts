import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createBus } from "../bus.ts";
import { openDb } from "../db.ts";
import { blankProfessor, getRecord, putRecord } from "../records.ts";
import { saveFacts } from "../state.ts";
import { documentPath, saveDocument } from "../vault.ts";
import { fakeMailer, fakeTokenEndpoint, type Mailer } from "./mail.ts";
import { SignedOut } from "./oauth.ts";
import { createOutreach } from "./service.ts";
import { conversations } from "./pipeline.ts";
import { listMessages, saveDraft } from "./store.ts";

const LOGIN = {
  name: "Applicant",
  address: "me@example.com",
  password: "app-password",
  imapHost: "imap.example.com",
  imapPort: 993,
  smtpHost: "smtp.example.com",
  smtpPort: 465,
};

/** A connected-ready store with one professor and a first-email draft to them. */
function setup(email = "lybarger@example.edu") {
  process.env.GRADCODE_HOME = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-mail-"));
  const db = openDb(":memory:");
  const record = {
    ...blankProfessor("Kevin Lybarger", "George Mason University"),
    email,
    emailCheck: "ok, on the lab page",
  };
  putRecord(db, record);
  const mailer = fakeMailer();
  const asked: string[] = [];
  const outreach = createOutreach({
    db,
    bus: createBus(),
    runner: { send: (_thread, text) => void asked.push(text) },
    mailerFor: () => mailer,
  });
  const draft = saveDraft(db, {
    recordKey: record.key,
    channel: "email",
    touch: "first",
    to: record.email,
    subject: "PhD 2027",
    body: "Dear Dr. Lybarger, ...",
    timeZone: "America/New_York",
    threadId: null,
  });
  if ("problem" in draft) throw new Error(draft.problem);
  return { db, record, mailer, asked, outreach, draft };
}

describe("outreach on a mailbox", () => {
  beforeEach(() => delete process.env.GRADCODE_HOME);

  it("keeps the login readable by this user only", async () => {
    const { outreach } = setup();
    expect((await outreach.connect(LOGIN)).connected).toBe(true);
    const file = NodePath.join(process.env.GRADCODE_HOME ?? "", "mail.json");
    expect(NodeFS.statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(outreach.status())).not.toContain(LOGIN.password);
  });

  it("refuses to approve before a mailbox is connected", async () => {
    const { outreach, draft } = setup();
    await expect(outreach.approve([draft.id])).rejects.toThrow(/Connect a mailbox/);
  });

  it("sends at the slot, files the reply, and hands it to the agent", async () => {
    const { db, record, mailer, asked, outreach, draft } = setup();
    await outreach.connect(LOGIN);
    await outreach.approve([draft.id]);
    expect(mailer.sent).toHaveLength(0);
    const [scheduled] = listMessages(db, record.key);
    expect(scheduled?.status).toBe("scheduled");
    const slot = new Date(scheduled?.scheduledAt ?? "");
    expect(["Tue", "Wed", "Thu"]).toContain(
      slot.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }),
    );

    await outreach.tick(slot);
    await outreach.tick(slot);
    expect(mailer.sent).toHaveLength(1);
    expect(getRecord(db, record.key)?.stage).toBe("sent");

    await outreach.sync();
    const [c] = conversations(db);
    expect(c).toMatchObject({ stage: "replied", turn: "yours" });
    expect(asked[0]).toMatch(/^\[reply:in_\S+\] Kevin Lybarger \(George Mason University\)/);
  });

  it("asks for each due follow-up once", async () => {
    // Nobody answers this address, so the sequence keeps running.
    const { asked, outreach, draft } = setup("quiet@example.edu");
    await outreach.connect(LOGIN);
    await outreach.sendNow(draft.id);
    const later = new Date(Date.now() + 20 * 864e5);
    await outreach.tick(later);
    await outreach.tick(later);
    expect(asked.filter((t) => t.startsWith("[follow-up]"))).toHaveLength(1);
    expect(asked[0]).toContain("follow-up-1");
  });
  it("sends a follow-up as an answer to the first email, so it threads under it", async () => {
    const { db, record, mailer, outreach, draft } = setup("quiet@example.edu");
    await outreach.connect(LOGIN);
    await outreach.sendNow(draft.id);
    const first = listMessages(db, record.key)[0];
    const bump = saveDraft(db, {
      recordKey: record.key,
      channel: "email",
      touch: "follow-up-1",
      to: record.email,
      subject: "Re: PhD 2027",
      body: "Dear Dr. Lybarger, a short follow-up ...",
      timeZone: "America/New_York",
      threadId: null,
    });
    if ("problem" in bump) throw new Error(bump.problem);
    await outreach.sendNow(bump.id);
    expect(first?.messageId).toBeTruthy();
    expect(mailer.sent.at(-1)?.inReplyTo).toBe(first?.messageId);
  });
});

describe("an attachment", () => {
  it("goes with the email from the vault, and only real documents can be attached", async () => {
    const { db, outreach, record, mailer } = setup();
    await outreach.connect(LOGIN);
    const cv = saveDocument(db, {
      name: "cv.pdf",
      kind: "cv",
      mime: "application/pdf",
      expires: null,
      base64: Buffer.from("%PDF-1.4 cv").toString("base64"),
    });
    const draft = (attach: string[], channel: "email" | "linkedin" = "email") =>
      saveDraft(db, {
        recordKey: record.key,
        channel,
        touch: "first",
        to: channel === "email" ? record.email : "https://www.linkedin.com/in/lybarger",
        subject: "PhD 2027",
        body: "Are you taking students?",
        timeZone: "America/New_York",
        threadId: null,
        attach,
      });
    expect(draft(["doc_missing"])).toEqual({ problem: "no document doc_missing in the vault" });
    expect(draft([cv.id], "linkedin")).toEqual({ problem: "only email carries attachments" });
    const ok = draft([cv.id]);
    if ("problem" in ok) throw new Error(ok.problem);
    await outreach.sendNow(ok.id);
    expect(mailer.sent.at(-1)?.attachments).toEqual([
      { filename: "cv.pdf", path: documentPath(cv.id) },
    ]);
  });
});

describe("signing in to a mailbox", () => {
  it("connects a Gmail box by OAuth and returns only to the app's own pages", async () => {
    process.env.GRADCODE_HOME = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-signin-"));
    const outreach = createOutreach({
      db: openDb(":memory:"),
      bus: createBus(),
      runner: { send: () => {} },
      mailerFor: () => fakeMailer(),
      signIn: { port: 4311, tokenFetch: fakeTokenEndpoint, scripted: true },
    });
    const start = (returnTo: string) =>
      new URL(
        outreach.startSignIn({
          provider: "google",
          clientId: "cid",
          clientSecret: "secret",
          name: "Ada",
          returnTo,
        }).url,
      );
    const ok = start("http://127.0.0.1:5174/settings");
    expect(ok.origin + ok.pathname).toBe("http://127.0.0.1:4311/api/oauth/callback");
    expect(
      await outreach.finishSignIn(ok.searchParams.get("state")!, ok.searchParams.get("code")!),
    ).toBe("http://127.0.0.1:5174/settings");
    expect(outreach.status()).toMatchObject({
      connected: true,
      via: "google",
      address: "applicant@example.com",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    const away = start("https://evil.example/phish");
    expect(await outreach.finishSignIn(away.searchParams.get("state")!, "scripted")).toBe("");
  });
});

describe("a draft that cites facts", () => {
  it("goes out without its citation markers", async () => {
    const { db, outreach, record, mailer } = setup();
    saveFacts(db, [
      {
        id: "f_team",
        text: "Led a team of five",
        source: "cv.pdf",
        kind: "other",
        date: "",
        confirmed: true,
        question: false,
        planned: false,
      },
    ]);
    await outreach.connect(LOGIN);
    const cited = saveDraft(db, {
      recordKey: record.key,
      channel: "email",
      touch: "first",
      to: record.email,
      subject: "PhD 2027",
      body: "I led a team of five [[f_team]]. Are you taking students?",
      timeZone: "America/New_York",
      threadId: null,
    });
    if ("problem" in cited) throw new Error(cited.problem);
    expect(cited.body).toBe("I led a team of five [1]. Are you taking students?");
    await outreach.sendNow(cited.id);
    expect(mailer.sent.at(-1)?.text).toBe("I led a team of five. Are you taking students?");
  });
});

describe("the test-score rule", () => {
  it("holds on the server: a draft claiming an unbacked score is never approved or sent", async () => {
    const { db, outreach, record } = setup();
    await outreach.connect(LOGIN);
    const claim = saveDraft(db, {
      recordKey: record.key,
      channel: "email",
      touch: "first",
      to: record.email,
      subject: "PhD 2027",
      body: "I scored IELTS 7.5 last month.",
      timeZone: "America/New_York",
      threadId: null,
    });
    if ("problem" in claim) throw new Error(claim.problem);
    await outreach.approve([claim.id]);
    expect(listMessages(db, record.key).find((m) => m.id === claim.id)?.status).toBe("draft");
    await expect(outreach.sendNow(claim.id)).rejects.toThrow(/test score/);
  });
});

describe("a mailbox that signs out", () => {
  it("says so, keeps the box and its warm-up, and a new app password brings it back", async () => {
    process.env.GRADCODE_HOME = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-mail-"));
    const db = openDb(":memory:");
    let refused = false;
    const box = fakeMailer();
    const mailer: Mailer = {
      ...box,
      fetchNew: (cursor) =>
        refused ? Promise.reject(new SignedOut("refused the app password")) : box.fetchNew(cursor),
    };
    const outreach = createOutreach({
      db,
      bus: createBus(),
      runner: { send: () => {} },
      mailerFor: () => mailer,
    });
    const before = await outreach.connect(LOGIN);
    refused = true;
    expect(await outreach.sync()).toMatchObject({ connected: true, signedOut: true });
    refused = false;
    const back = await outreach.repassword("new-app-password");
    expect(back).toMatchObject({ signedOut: false, warmupStart: before.warmupStart });
  });
});
