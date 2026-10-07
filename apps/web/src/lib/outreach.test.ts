import type { Conversation, OutreachMessage, Professor } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { cardLine, nextStep, openDraft, sequence } from "./outreach";

const record: Professor = {
  key: "kevin-lybarger@gmu",
  name: "Kevin Lybarger",
  university: "George Mason University",
  department: "",
  niche: "clinical NLP",
  fit: 5,
  moneyTier: 2,
  eligibility: "ok",
  taking: "",
  money: "",
  lasts: "",
  email: "lybarger@example.edu",
  emailCheck: "ok",
  contact: "",
  stage: "sent",
  fitsBecause: "",
  website: "",
  sources: [],
  grants: [],
  origin: "app",
  updatedAt: "2026-10-13T12:00:00.000Z",
};

// Times are 10:30 UTC: the same calendar day from UTC-10 to UTC+13, so labels don't depend on TZ.
const msg = (m: Partial<OutreachMessage>): OutreachMessage => ({
  id: crypto.randomUUID(),
  recordKey: record.key,
  channel: "email",
  direction: "out",
  touch: "first",
  kind: null,
  replyClass: null,
  status: "sent",
  from: "",
  to: "lybarger@example.edu",
  subject: "PhD 2027",
  body: "Hello",
  timeZone: "America/New_York",
  scheduledAt: null,
  at: "2026-10-13T10:30:00.000Z",
  messageId: null,
  inReplyTo: null,
  threadId: null,
  note: "",
  createdAt: "2026-10-12T00:00:00.000Z",
  ...m,
});

const convo = (c: Partial<Conversation>): Conversation => ({
  record,
  messages: [],
  stage: "contacted",
  turn: "theirs",
  followUpAt: null,
  stopped: null,
  lastAt: "2026-10-13T12:00:00.000Z",
  ...c,
});

describe("the Pipeline's reading of a conversation", () => {
  it("plans both follow-ups while waiting, and pauses them once they reply", () => {
    const waiting = convo({ messages: [msg({})], followUpAt: "2026-10-22T10:30:00.000Z" });
    expect(sequence(waiting).map((s) => `${s.label}:${s.state}`)).toEqual([
      "First email:done",
      "Follow-up 1:later",
      "Follow-up 2:later",
    ]);
    expect(cardLine(waiting)).toBe("sent Oct 13 · follow-up Oct 22");

    const replied = convo({
      stage: "replied",
      turn: "yours",
      stopped: "they replied",
      messages: [
        msg({}),
        msg({
          direction: "in",
          touch: null,
          kind: "reply",
          status: "received",
          note: "asks for CV",
        }),
        msg({ touch: "reply", status: "draft", at: null }),
      ],
    });
    expect(sequence(replied).at(-1)).toMatchObject({ label: "Follow-up 1", state: "off" });
    expect(openDraft(replied)?.touch).toBe("reply");
    expect(cardLine(replied)).toBe("your turn · asks for CV");
    expect(nextStep(replied)).toMatch(/send the drafted answer/);
  });
});
