import type { Conversation, OutreachMessage, Professor } from "@getmyprof/contracts";
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
  linkedin: "",
  scholar: "",
  recent: "",
  seeking: "",
  lab: "",
  warm: "",
  hook: "",
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
  citations: {},
  attachments: [],
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
  program: null,
  applied: null,
  offer: null,
  ...c,
});

describe("the Pipeline's reading of a conversation", () => {
  it("plans both follow-ups while waiting, and pauses them once they reply", () => {
    const waiting = convo({ messages: [msg({})], followUpAt: "2026-10-22T10:30:00.000Z" });
    expect(sequence(waiting).map((s) => `${s.label}:${s.state}`)).toEqual([
      "First email:done",
      "Follow-up 1:later",
      "Follow-up 2:later",
      "After applying: I named you:later",
    ]);
    expect(cardLine(waiting)).toBe("sent Oct 13 · follow-up Oct 22");

    // Each step says what it says or will bring: the first email's opening line, and a planned
    // follow-up's angle, the applicant's newest fact since the send or the fallback.
    const fact = {
      id: "f_medqa",
      text: "4 points on MedQA",
      source: "notes.md",
      kind: "project" as const,
      date: "2026-10-20",
      confirmed: true,
      question: false,
      planned: false,
    };
    const said = convo({ messages: [msg({ body: "Dear Dr. Lybarger,\n\nI read DF-RAG [1]." })] });
    expect(sequence(said).map((s) => s.detail)).toEqual([
      "I read DF-RAG.",
      "their newer work, or only the one question",
      "a short call or your CV, then the last note",
      "",
    ]);
    expect(
      sequence(said, [fact])
        .filter((s) => s.id.startsWith("plan-"))
        .map((s) => s.detail),
    ).toEqual(["brings: 4 points on MedQA", "a short call or your CV, then the last note", ""]);
    // A fact from before the send isn't new.
    expect(
      sequence(said, [{ ...fact, date: "2026-10-01" }]).find((s) => s.id === "plan-1")?.detail,
    ).toBe("their newer work, or only the one question");

    // Once they're named in a submitted application, the note is the next thing to do.
    const applied = convo({
      stage: "applied",
      stopped: "you applied and named them",
      messages: [msg({})],
      program: { name: "PhD in IT", deadline: null },
      applied: { status: "submitted", submittedAt: "2026-11-02T12:00:00.000Z" },
    });
    expect(sequence(applied).find((s) => s.id === "plan-applied")?.state).toBe("now");
    expect(cardLine(applied)).toBe("PhD in IT · submitted Nov 2");

    // The hunt ended before a first email went: the card doesn't offer its draft any more.
    const ended = convo({
      stage: "to-contact",
      turn: "closed",
      messages: [msg({ status: "draft" })],
    });
    expect(cardLine(ended)).toBe("closed");

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
