import type { OutreachMessage, Professor } from "@getmyprof/contracts";
import { describe, expect, it } from "vite-plus/test";
import { blankProfessor } from "../records.ts";
import { draftProblem, standing } from "./store.ts";

const prof: Professor = {
  ...blankProfessor("Kevin Lybarger", "George Mason University"),
  email: "lybarger@example.edu",
  stage: "sent",
};

let n = 0;
const msg = (m: Partial<OutreachMessage>): OutreachMessage => ({
  id: `m${++n}`,
  recordKey: prof.key,
  channel: "email",
  direction: "out",
  touch: "first",
  kind: null,
  replyClass: null,
  status: "sent",
  from: "",
  to: prof.email,
  subject: "PhD 2027",
  body: "Hello",
  timeZone: "America/New_York",
  scheduledAt: null,
  at: "2026-10-13T12:00:00.000Z",
  messageId: null,
  inReplyTo: null,
  threadId: null,
  note: "",
  citations: {},
  attachments: [],
  voice: "agent",
  ownWords: "",
  fixes: [],
  createdAt: "2026-10-12T00:00:00.000Z",
  ...m,
});
/** An incoming message, received (createdAt) when its Date header says unless told otherwise. */
const incoming = (m: Partial<OutreachMessage>) => {
  const at = m.at ?? "2026-10-14T09:00:00.000Z";
  return msg({ direction: "in", touch: null, status: "received", at, createdAt: at, ...m });
};
const reply = (m: Partial<OutreachMessage> = {}) => incoming({ kind: "reply", ...m });

// First email Tue Oct 13 2026. +7 business days is Thu Oct 22; +14 is Mon Nov 2.
const first = msg({});

describe("where a professor stands", () => {
  it("waits on them, then a follow-up comes due 7 business days after the first email", () => {
    const before = standing(prof, [first], new Date("2026-10-20T00:00:00Z"));
    expect(before).toMatchObject({ stage: "contacted", turn: "theirs", stopped: null });
    expect(before.followUpAt?.slice(0, 10)).toBe("2026-10-22");

    const due = standing(prof, [first], new Date("2026-10-23T00:00:00Z"));
    expect(due).toMatchObject({ stage: "follow-up", turn: "follow-up" });

    const second = msg({ touch: "follow-up-1", at: "2026-10-22T12:00:00.000Z" });
    expect(standing(prof, [first, second], new Date("2026-10-23T00:00:00Z")).followUpAt).toMatch(
      /^2026-11-02/,
    );
  });

  it("stops following up on a reply, and it's your turn until you answer", () => {
    const theirs = reply({ at: "2026-10-14T09:00:00.000Z" });
    const s = standing(prof, [first, theirs], new Date("2026-11-30T00:00:00Z"));
    expect(s).toMatchObject({ stage: "replied", turn: "yours", stopped: "they replied" });
    expect(s.followUpAt).toBeNull();

    const answer = msg({ touch: "reply", at: "2026-10-14T10:00:00.000Z" });
    expect(standing(prof, [first, theirs, answer], new Date()).turn).toBe("theirs");
  });

  it("still waits on you when their server's clock stamps the reply before our send", () => {
    const skewed = reply({ at: "2026-10-13T11:59:00.000Z", createdAt: "2026-10-13T12:03:00.000Z" });
    expect(standing(prof, [first, skewed], new Date()).turn).toBe("yours");
  });

  it("moves to Call when they propose one, and closes when they aren't taking students", () => {
    expect(standing(prof, [first, reply({ replyClass: "call" })], new Date()).stage).toBe("call");
    const no = standing(prof, [first, reply({ replyClass: "not-taking" })], new Date());
    expect(no).toMatchObject({ stage: "closed", turn: "closed", stopped: "not taking students" });
  });

  it("waits out an out-of-office before following up", () => {
    const away = incoming({
      kind: "auto-reply",
      at: "2026-10-13T12:05:00.000Z",
      body: "I am out of the office until November 9, 2026.",
    });
    const s = standing(prof, [first, away], new Date("2026-10-23T00:00:00Z"));
    expect(s.stage).toBe("contacted");
    expect(s.followUpAt?.slice(0, 10)).toBe("2026-11-09");
  });

  it("puts a bounce back in your hands", () => {
    const bounce = incoming({ kind: "bounce", at: "2026-10-13T12:01:00.000Z" });
    expect(standing(prof, [first, bounce], new Date())).toMatchObject({
      stage: "to-contact",
      turn: "yours",
      stopped: "bounced",
    });
  });
});

describe("a draft", () => {
  const fresh = { ...prof, stage: "new" as const };
  const email = { channel: "email" as const, touch: "first" as const, to: prof.email, body: "Hi" };

  it("goes only to the reviewed address", () => {
    expect(draftProblem(fresh, [], email)).toBeNull();
    expect(draftProblem(fresh, [], { ...email, to: "guess@example.edu" })).toMatch(
      /reviewed address/,
    );
    expect(draftProblem({ ...fresh, email: "" }, [], email)).toMatch(/no address/);
    expect(draftProblem({ ...fresh, emailCheck: "bounced 2026-10-13" }, [], email)).toMatch(
      /failed its check/,
    );
  });

  it("never reaches apply-only professors, gradhunt's rows, or someone already contacted", () => {
    expect(draftProblem({ ...fresh, contact: "apply-only, no cold email" }, [], email)).toMatch(
      /apply-only/,
    );
    expect(draftProblem({ ...fresh, origin: "gradhunt" }, [], email)).toMatch(/gradhunt/);
    expect(draftProblem(prof, [first], email)).toBe("already contacted");
    expect(draftProblem(fresh, [], { ...email, touch: "follow-up-1" })).toMatch(/no first email/);
    expect(draftProblem(prof, [first, reply()], { ...email, touch: "follow-up-1" })).toMatch(
      /stopped: they replied/,
    );
  });
});
