import type { OutreachMessage } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { openDb } from "../db.ts";
import { dueLoops, saveLoop } from "../loops.ts";
import { blankProfessor, putRecord } from "../records.ts";
import { saveEdit, startApplication } from "../vault.ts";
import { conversations } from "./pipeline.ts";
import { dueToSend, putMessage } from "./store.ts";

const sent: OutreachMessage = {
  id: "out_1",
  recordKey: "",
  channel: "email",
  direction: "out",
  touch: "first",
  kind: null,
  replyClass: null,
  status: "sent",
  from: "me@example.com",
  to: "lybarger@gmu.edu",
  subject: "PhD 2027",
  body: "Hello",
  timeZone: "America/New_York",
  scheduledAt: null,
  at: "2026-10-01T12:00:00.000Z",
  messageId: "<1@x>",
  inReplyTo: null,
  threadId: null,
  note: "",
  citations: {},
  attachments: [],
  createdAt: "2026-10-01T12:00:00.000Z",
};

function setup() {
  const db = openDb(":memory:");
  const prof = {
    ...blankProfessor("Kevin Lybarger", "George Mason University"),
    email: "lybarger@gmu.edu",
    emailCheck: "ok",
    stage: "sent" as const,
  };
  putRecord(db, prof);
  putMessage(db, { ...sent, recordKey: prof.key });
  saveEdit(db, {
    kind: "program",
    value: {
      id: "prg_1",
      university: "George Mason University",
      name: "PhD in Information Technology",
      degree: "phd",
      deadline: "2026-12-01",
      fee: "",
      waiver: "",
      english: "",
      funding: "",
      url: "",
      sources: [],
      note: "",
    },
  });
  return { db, prof };
}

describe("the pipeline after applying", () => {
  it("moves the professors an application names to Applied, then to Offer", () => {
    const { db, prof } = setup();
    const at = new Date("2026-10-05T12:00:00.000Z");
    expect(conversations(db, at)[0]).toMatchObject({ stage: "contacted", applied: null });

    const app = startApplication(db, "prg_1");
    saveEdit(db, {
      kind: "application",
      value: { ...app, status: "submitted", professors: [prof.key], submittedAt: at.toISOString() },
    });
    expect(conversations(db, at)[0]).toMatchObject({
      stage: "applied",
      stopped: "you applied and named them",
      followUpAt: null,
      program: { name: "PhD in Information Technology", deadline: "2026-12-01" },
    });

    saveEdit(db, { kind: "offer", value: offer("open") });
    expect(conversations(db, at)[0]).toMatchObject({ stage: "offer", turn: "yours" });
  });

  it("ends the hunt on an accepted offer: no loop runs, cold mail waits, answers still go", () => {
    const { db, prof } = setup();
    saveLoop(db, {
      name: "Nightly sweep",
      instructions: "Sweep.",
      schedule: { kind: "every", hours: 0.01 },
      budgetUsd: 0.5,
      enabled: true,
    });
    const later = new Date(Date.now() + 3_600_000);
    expect(dueLoops(db, later)).toHaveLength(1);
    const queued = { status: "scheduled" as const, scheduledAt: new Date().toISOString() };
    putMessage(db, { ...sent, ...queued, id: "out_2", recordKey: prof.key, touch: "follow-up-1" });
    putMessage(db, { ...sent, ...queued, id: "out_3", recordKey: prof.key, touch: "reply" });

    // A cold draft waiting for approval can't go anywhere once the hunt is over.
    const zalake = {
      ...blankProfessor("Mohan Zalake", "UIC"),
      email: "z@uic.edu",
      emailCheck: "ok",
    };
    putRecord(db, zalake);
    putMessage(db, { ...sent, id: "out_4", recordKey: zalake.key, status: "draft", at: null });
    expect(conversations(db).find((c) => c.record.key === zalake.key)?.turn).toBe("approve");

    saveEdit(db, { kind: "offer", value: offer("accepted") });
    expect(conversations(db).find((c) => c.record.key === zalake.key)?.turn).toBe("closed");
    expect(dueLoops(db, later)).toEqual([]);
    expect(dueToSend(db, later).map((m) => m.id)).toEqual(["out_3"]);
    expect(conversations(db)[0]?.stopped).toBe("you accepted an offer");
  });

  it("lists a checked professor with no draft yet under To contact", () => {
    const { db } = setup();
    const ready = {
      ...blankProfessor("Natalie Parde", "University of Illinois Chicago"),
      email: "parde@uic.edu",
      emailCheck: "ok, on the lab page",
    };
    putRecord(db, ready);
    putRecord(db, { ...blankProfessor("No Address", "Uni"), email: "" });
    const parde = conversations(db).find((c) => c.record.key === ready.key);
    expect(parde).toMatchObject({ stage: "to-contact", turn: "yours" });
    expect(conversations(db).some((c) => c.record.name === "No Address")).toBe(false);
  });
});

function offer(status: "open" | "accepted") {
  return {
    id: "off_1",
    university: "George Mason University",
    program: "PhD in Information Technology",
    stipend: 30000,
    stipendPer: "year" as const,
    currency: "USD",
    tuition: "full" as const,
    years: 5,
    insurance: "",
    duties: "",
    rentPerMonth: null,
    respondBy: null,
    status,
    note: "",
  };
}
