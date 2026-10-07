import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createBus } from "../bus.ts";
import { openDb } from "../db.ts";
import { blankProfessor, getRecord, putRecord } from "../records.ts";
import { fakeMailer } from "./mail.ts";
import { createOutreach } from "./service.ts";
import { conversations, listMessages, saveDraft } from "./store.ts";

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
});
