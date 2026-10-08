import { type Conversation, type OutreachMessage, Professor } from "@getmyprof/contracts";
import { describe, expect, it } from "vite-plus/test";
import { replyInsights } from "./insights";

const professor = (name: string, moneyTier: number) =>
  Professor.parse({
    key: name,
    name,
    university: "George Mason University",
    department: "",
    niche: "",
    fit: 4,
    moneyTier,
    taking: "",
    money: "",
    lasts: "",
    email: "",
    emailCheck: "ok",
    contact: "",
    stage: "sent",
    fitsBecause: "",
    website: "",
    sources: [],
    grants: [],
    origin: "app",
    updatedAt: "",
  });

const msg = (m: Partial<OutreachMessage>): OutreachMessage => ({
  id: crypto.randomUUID(),
  recordKey: "",
  channel: "email",
  direction: "out",
  touch: "first",
  kind: null,
  replyClass: null,
  status: "sent",
  from: "",
  to: "",
  subject: "",
  body: "Hello",
  timeZone: "America/New_York",
  scheduledAt: null,
  at: null,
  messageId: null,
  inReplyTo: null,
  threadId: null,
  note: "",
  citations: {},
  attachments: [],
  createdAt: "",
  ...m,
});

const convo = (record: Professor, messages: OutreachMessage[]): Conversation => ({
  record,
  messages,
  stage: "contacted",
  turn: "theirs",
  followUpAt: null,
  stopped: null,
  lastAt: "",
  program: null,
  applied: null,
  offer: null,
});

const words = (n: number) => Array.from({ length: n }, () => "word [1]").join(" ");
const reply = msg({ direction: "in", touch: null, kind: "reply", status: "received" });

describe("reply insights", () => {
  it("counts sent first emails and real replies, by tier, length and the professor's weekday", () => {
    const insights = replyInsights([
      // 03:00 UTC on a Tuesday is still Monday evening in New York.
      convo(professor("A", 1), [msg({ body: words(80), at: "2026-10-13T03:00:00Z" }), reply]),
      convo(professor("B", 1), [msg({ body: words(120), at: "2026-10-13T15:00:00Z" })]),
      convo(professor("C", 0), [
        msg({ body: words(200), at: "2026-10-14T15:00:00Z", timeZone: "Asia/Dhaka" }),
        msg({ direction: "in", touch: null, kind: "bounce", status: "received" }),
      ]),
      // A draft and a LinkedIn note aren't sent first emails.
      convo(professor("D", 2), [msg({ status: "draft" })]),
      convo(professor("E", 2), [msg({ channel: "linkedin", at: "2026-10-13T15:00:00Z" })]),
    ]);
    expect(insights).toMatchObject({
      sent: 3,
      replied: 1,
      byTier: [
        { label: "Tier 1", sent: 2, replied: 1 },
        { label: "No tier", sent: 1, replied: 0 },
      ],
      byLength: [
        { label: "Under 100 words", sent: 1, replied: 1 },
        { label: "100 to 150 words", sent: 1, replied: 0 },
        { label: "Over 150 words", sent: 1, replied: 0 },
      ],
      byWeekday: [
        { label: "Mon", sent: 1, replied: 1 },
        { label: "Tue", sent: 1, replied: 0 },
        { label: "Wed", sent: 1, replied: 0 },
      ],
      byHook: [{ label: "Neither", sent: 3, replied: 1 }],
    });
  });

  it("splits by hook or warm path", () => {
    const sent = msg({ at: "2026-10-13T15:00:00Z" });
    const insights = replyInsights([
      convo(Object.assign(professor("A", 1), { hook: "cited their ACL paper" }), [sent, reply]),
      convo(Object.assign(professor("B", 1), { warm: "none found" }), [sent]),
    ]);
    expect(insights.byHook).toEqual([
      { label: "Hook or warm path", sent: 1, replied: 1 },
      { label: "Neither", sent: 1, replied: 0 },
    ]);
  });
});
