import type { ServerMessage, ThreadEvent } from "@getmyprof/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createBus } from "../bus.ts";
import { openDb } from "../db.ts";
import { saveLoop } from "../loops.ts";
import { resolveProposal, threadProposals } from "../records.ts";
import { updateSettings } from "../state.ts";
import {
  createThread,
  forkThread,
  putEvent,
  setSession,
  setStatus,
  getThread,
  listEvents,
  searchThreads,
  settleIfDone,
  sharesSession,
  threadSpend,
} from "../threads.ts";
import { listPrograms, listSchools, proposeSchool, saveEdit } from "../vault.ts";
import { fakeProvider } from "./fake.ts";
import { FIXTURE_DECISIONS, fixtureSources } from "./fixtures.ts";
import { createRunner } from "./runner.ts";

const until = async (check: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("a fake agent turn", () => {
  it("proposes rows, asks before a paid call, records spend, and settles once reviewed", async () => {
    const db = openDb(":memory:");
    updateSettings(db, { treg: true });
    const bus = createBus();
    const pushed: ServerMessage[] = [];
    bus.add((m) => pushed.push(m));
    const runner = createRunner({ db, bus, provider: fakeProvider(1), sources: fixtureSources });
    const thread = createThread(db, "health NLP").id;

    runner.send(thread, "find health NLP professors", "send");
    await until(() => getThread(db, thread)?.status === "approval");
    const approval = listEvents(db, thread).find(
      (e): e is Extract<ThreadEvent, { type: "approval" }> => e.type === "approval",
    );
    expect(approval?.costUsd).toBe(0.0245);

    runner.resolveApproval(approval!.id, "once");
    await until(() => getThread(db, thread)?.status === "idle");

    expect(threadSpend(db, thread)).toBe(0.0245);
    expect(
      listEvents(db, thread)
        .filter((e) => e.type === "tool")
        .map((e) => e.name),
    ).toContain("propose_professor");
    expect(pushed.some((m) => m.type === "threads")).toBe(true);

    const pending = threadProposals(db, thread);
    expect(pending).toHaveLength(3);
    expect(settleIfDone(db, thread)).toBe(false);
    for (const p of pending) resolveProposal(db, p.id, "accept");
    expect(settleIfDone(db, thread)).toBe(true);
  });

  it("skips the paid call when the user declines", async () => {
    const db = openDb(":memory:");
    updateSettings(db, { treg: true });
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "t").id;
    runner.send(thread, "go", "send");
    await until(() => getThread(db, thread)?.status === "approval");
    const approval = listEvents(db, thread).find((e) => e.type === "approval");
    runner.resolveApproval(approval!.id, "deny");
    await until(() => getThread(db, thread)?.status === "idle");
    expect(threadSpend(db, thread)).toBe(0);
    expect(listEvents(db, thread).some((e) => e.type === "tool" && e.status === "denied")).toBe(
      true,
    );
  });
});

describe("an Ask turn", () => {
  it("reads only: the scripted hunt's proposals and paid lookup are refused", async () => {
    const db = openDb(":memory:");
    updateSettings(db, { treg: true });
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "ask").id;
    runner.send(thread, "[ask] who works on clinical NLP?", "send");
    await until(() => getThread(db, thread)?.status === "idle");
    const events = listEvents(db, thread);
    expect(events.find((e) => e.type === "user")).toMatchObject({
      text: "Ask · who works on clinical NLP?",
    });
    expect(threadProposals(db, thread)).toHaveLength(0);
    expect(threadSpend(db, thread)).toBe(0);
    expect(
      events.some((e) => e.type === "tool" && e.status === "denied" && e.meta === "ask mode"),
    ).toBe(true);
  });

  it("shows only what was typed, not the record that rides along for the agent", async () => {
    const db = openDb(":memory:");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "ask").id;
    const typed = "[ask] what money do they have?";
    runner.send(
      thread,
      `${typed}\n\nScope: Kevin Lybarger. ...\n- Kevin Lybarger | key k`,
      "send",
      typed,
    );
    await until(() => getThread(db, thread)?.status === "idle");
    const events = listEvents(db, thread);
    expect(events.find((e) => e.type === "user")).toMatchObject({
      text: "Ask · what money do they have?",
    });
    expect(events.some((e) => e.type === "assistant" && e.text.includes("From the sheet"))).toBe(
      true,
    );
  });
});

describe("a loop run at its cap", () => {
  it("stops and says why, without paying", async () => {
    const db = openDb(":memory:");
    updateSettings(db, { treg: true });
    const loop = saveLoop(db, {
      name: "Nightly sweep",
      instructions: "Sweep.",
      schedule: { kind: "daily", at: "02:00" },
      budgetUsd: 0.01,
      enabled: true,
    });
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "Nightly sweep", loop.id).id;
    runner.send(thread, "sweep", "send");
    await until(() => listEvents(db, thread).some((e) => e.type === "system"));
    await until(() => getThread(db, thread)?.status === "idle");
    const stop = listEvents(db, thread).find((e) => e.type === "system");
    expect(stop?.type === "system" && stop.text).toBe(
      "Stopped: This would pass the $0.01 cap for this loop run.",
    );
    expect(threadSpend(db, thread)).toBe(0);
    expect(listEvents(db, thread).some((e) => e.type === "approval")).toBe(false);
  });
});

describe("a question to the applicant", () => {
  it("leaves the thread in Input until the next message answers it", async () => {
    const db = openDb(":memory:");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "t").id;
    runner.send(thread, "ask me what you need", "send");
    await until(() => getThread(db, thread)?.status === "input");
    const asked = listEvents(db, thread).find((e) => e.type === "question");
    expect(asked).toMatchObject({ status: "pending" });
    expect(settleIfDone(db, thread)).toBe(false);

    runner.send(thread, "IELTS in November", "send");
    await until(() => getThread(db, thread)?.status === "idle");
    expect(listEvents(db, thread).find((e) => e.type === "question")).toMatchObject({
      status: "answered",
    });
  });
});

describe("thread search", () => {
  it("finds a thread by words in its messages and tool calls, with a snippet", async () => {
    const db = openDb(":memory:");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "health NLP").id;
    runner.send(thread, "find health NLP professors", "send");
    await until(() => getThread(db, thread)?.status === "idle");
    expect(searchThreads(db, "zalake")).toEqual([
      expect.objectContaining({ threadId: thread, title: "health NLP" }),
    ]);
    expect(searchThreads(db, "zalake")[0]?.snippet).toMatch(/Zalake/);
    expect(searchThreads(db, "nothing like this")).toEqual([]);
  });
});

describe("forking a thread", () => {
  it("copies the transcript and rows, and the copy's first message branches the conversation", async () => {
    const db = openDb(":memory:");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const source = createThread(db, "health NLP").id;
    runner.send(source, "find health NLP professors", "send");
    await until(
      () => getThread(db, source)?.status === "idle" && (getThread(db, source)?.rows ?? 0) > 0,
    );

    // Review stays with the original thread; accepted rows are the sheet's and carry over.
    for (const p of threadProposals(db, source)) resolveProposal(db, p.id, "accept");
    const copy = forkThread(db, source);
    expect(listEvents(db, copy.id)).toHaveLength(listEvents(db, source).length);
    expect(copy.rows).toBe(getThread(db, source)?.rows);
    expect(sharesSession(db, copy.id)).toBe(true);

    runner.send(copy.id, "now only Chicago", "send");
    await until(() => getThread(db, copy.id)?.status === "idle");
    expect(sharesSession(db, copy.id)).toBe(false);
    expect(
      listEvents(db, source).some((e) => e.type === "user" && e.text === "now only Chicago"),
    ).toBe(false);
  });
});

describe("a queued message", () => {
  it("waits for the next tool call, can be edited until then, and the agent gets the edit", async () => {
    const db = openDb(":memory:");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(40),
      sources: fixtureSources,
    });
    const thread = createThread(db, "t").id;
    runner.send(thread, "find health NLP professors", "send");
    await until(() => getThread(db, thread)?.status === "working");
    runner.send(thread, "only Chicago", "queued");
    const queued = listEvents(db, thread).findLast((e) => e.type === "user");
    expect(runner.editQueued(thread, queued!.id, "only UIC")).toBe(true);

    await until(
      () =>
        getThread(db, thread)?.status === "idle" &&
        listEvents(db, thread).some((e) => e.type === "assistant" && e.text.includes("only UIC")),
    );
    expect(listEvents(db, thread).find((e) => e.id === queued!.id)).toMatchObject({
      text: "only UIC",
      delivery: "send",
    });
    expect(runner.editQueued(thread, queued!.id, "too late")).toBe(false);
  });
});

describe("steering a queued message", () => {
  it("sends it now instead of after the tool call, once", async () => {
    const db = openDb(":memory:");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(40),
      sources: fixtureSources,
    });
    const thread = createThread(db, "t").id;
    runner.send(thread, "find health NLP professors", "send");
    await until(() => getThread(db, thread)?.status === "working");
    runner.send(thread, "only Chicago", "queued");
    const queued = listEvents(db, thread).findLast((e) => e.type === "user");
    expect(runner.steerQueued(thread, queued!.id)).toBe(true);
    expect(listEvents(db, thread).find((e) => e.id === queued!.id)).toMatchObject({
      delivery: "steered",
    });
    expect(runner.steerQueued(thread, queued!.id)).toBe(false);
    await until(() =>
      listEvents(db, thread).some((e) => e.type === "assistant" && e.text.includes("only Chicago")),
    );
  });
});

describe("a restart mid-turn", () => {
  it("lapses waiting approvals and picks the turn back up, but only once", async () => {
    const db = openDb(":memory:");
    const thread = createThread(db, "t").id;
    setSession(db, thread, "sess-1");
    setStatus(db, thread, "approval");
    putEvent(db, thread, {
      id: "ap1",
      at: new Date().toISOString(),
      type: "approval",
      title: "Paid lookup",
      body: "treg.people.email.find",
      why: "",
      costUsd: 0.02,
      status: "pending",
    });
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    runner.resumeAfterRestart();
    expect(listEvents(db, thread).find((e) => e.id === "ap1")).toMatchObject({ status: "denied" });
    expect(
      listEvents(db, thread).some((e) => e.type === "system" && /restarted/.test(e.text)),
    ).toBe(true);
    await until(() => getThread(db, thread)?.status === "idle");

    // Cut off again right after resuming: left idle, not resumed a second time.
    const again = createThread(db, "again").id;
    setSession(db, again, "sess-2");
    setStatus(db, again, "working");
    putEvent(db, again, {
      id: "sys1",
      at: new Date().toISOString(),
      type: "system",
      text: "The server restarted mid-turn · picking up where it left off",
    });
    runner.resumeAfterRestart();
    expect(getThread(db, again)?.status).toBe("idle");
    expect(listEvents(db, again)).toHaveLength(1);
  });
});

describe("notes from a turn", () => {
  it("puts decision timing on each Vault program, and a school's stipend and rent on the shortlist", async () => {
    const db = openDb(":memory:");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const program = {
      id: "prg_1",
      university: "George Mason University",
      name: "PhD in Information Technology",
      degree: "phd" as const,
      deadline: "2026-12-01",
      fee: "$75",
      waiver: "",
      english: "IELTS 6.5",
      funding: "",
      url: "",
      sources: ["https://cec.gmu.edu"],
      note: "",
    };
    saveEdit(db, { kind: "program", value: program });
    proposeSchool(db, {
      name: "George Mason University",
      country: "USA",
      tier: "match",
      rank: "",
      admits: "committee",
      why: "",
      sources: [],
    });

    const timing = createThread(db, "Decision timing").id;
    runner.send(timing, "For each program in my Vault, read last cycle's results.", "send");
    await until(() => getThread(db, timing)?.status === "idle");
    // Only the notes change; everything the applicant filed stays.
    expect(listPrograms(db)).toMatchObject([
      {
        ...program,
        decisions: FIXTURE_DECISIONS.decisions,
        sources: ["https://cec.gmu.edu", FIXTURE_DECISIONS.source],
      },
    ]);

    const check = createThread(db, "Programs").id;
    runner.send(check, "Find programs at George Mason University: deadline, fee.", "send");
    await until(() => getThread(db, check)?.status === "idle");
    expect(listSchools(db)).toMatchObject([{ stipendUsd: 32000, rentUsd: 1100 }]);
  });
});
