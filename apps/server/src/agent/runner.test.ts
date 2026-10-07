import type { ServerMessage, ThreadEvent } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createBus } from "../bus.ts";
import { openDb } from "../db.ts";
import { resolveProposal, threadProposals } from "../records.ts";
import { updateSettings } from "../state.ts";
import { createThread, getThread, listEvents, settleIfDone, threadSpend } from "../threads.ts";
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
