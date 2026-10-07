import type { ServerMessage, ThreadEvent } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createBus } from "../bus.ts";
import { openDb } from "../db.ts";
import { resolveProposal, threadProposals } from "../records.ts";
import { updateSettings } from "../state.ts";
import {
  createThread,
  forkThread,
  getThread,
  listEvents,
  searchThreads,
  settleIfDone,
  sharesSession,
  threadSpend,
} from "../threads.ts";
import { fakeProvider } from "./fake.ts";
import { fixtureSources } from "./fixtures.ts";
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

    runner.resolveApproval(approval!.id, true);
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
    runner.resolveApproval(approval!.id, false);
    await until(() => getThread(db, thread)?.status === "idle");
    expect(threadSpend(db, thread)).toBe(0);
    expect(listEvents(db, thread).some((e) => e.type === "tool" && e.status === "denied")).toBe(
      true,
    );
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
