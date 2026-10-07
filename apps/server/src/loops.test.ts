import type { ThreadEvent } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createBus } from "./bus.ts";
import { fakeProvider } from "./agent/fake.ts";
import { fixtureSources } from "./agent/fixtures.ts";
import { createRunner, runSummary } from "./agent/runner.ts";
import { openDb } from "./db.ts";
import { acceptByRules, autoAccepts, listLoops, loopStats, saveLoop } from "./loops.ts";
import { getRecord, propose, recordKey } from "./records.ts";
import { updateSettings } from "./state.ts";
import { allowUnder, createThread, getThread, listEvents, recordSpend } from "./threads.ts";

const verified = { email: "a@gmu.edu", emailCheck: "ok, on the lab page", fit: 5, website: "" };
const ALL = { verifiedEmail: true, officialSource: true, fit4: true };

describe("auto-accept rules", () => {
  it("take a change only when every rule that's on holds", () => {
    expect(autoAccepts(ALL, verified, ["https://cs.gmu.edu/~ada"])).toBe(true);
    // A blog isn't the university's own page; a unit page under .ac.uk is.
    expect(autoAccepts(ALL, verified, ["https://medium.com/@ada"])).toBe(false);
    expect(autoAccepts(ALL, verified, ["https://www.cl.cam.ac.uk/~ada"])).toBe(true);
    expect(autoAccepts(ALL, { ...verified, emailCheck: "invalid" }, ["https://gmu.edu"])).toBe(
      false,
    );
    expect(autoAccepts(ALL, { ...verified, fit: 3 }, ["https://gmu.edu"])).toBe(false);
    expect(autoAccepts({ ...ALL, fit4: false }, { ...verified, fit: 3 }, ["https://gmu.edu"])).toBe(
      true,
    );
    // Nothing on takes nothing.
    const none = { verifiedEmail: false, officialSource: false, fit4: false };
    expect(autoAccepts(none, verified, ["https://gmu.edu"])).toBe(false);
  });

  it("accept a run's proposal into the sheet only for a loop that may finish on its own", () => {
    const db = openDb(":memory:");
    const loop = (autonomy: "propose" | "auto") =>
      saveLoop(db, {
        name: autonomy,
        instructions: "sweep",
        schedule: { kind: "every", hours: 24 },
        budgetUsd: 0,
        enabled: true,
        autonomy,
        rules: ALL,
      });
    const add = (loopId: string, name: string) => {
      const thread = createThread(db, "run", loopId).id;
      const r = propose(db, thread, {
        name,
        university: "George Mason University",
        sources: ["https://cs.gmu.edu/people"],
        fields: { fit: 5, email: "x@gmu.edu", emailCheck: "ok" },
      });
      if (!("proposal" in r)) throw new Error("not proposed");
      return { thread, proposal: r.proposal };
    };

    const auto = add(loop("auto").id, "Ada Auto");
    expect(acceptByRules(db, auto.thread, auto.proposal, false)).toBe(true);
    expect(getRecord(db, recordKey("Ada Auto", "George Mason University"))?.fit).toBe(5);

    const manual = add(loop("propose").id, "Bo Manual");
    expect(acceptByRules(db, manual.thread, manual.proposal, false)).toBe(false);
    expect(getRecord(db, recordKey("Bo Manual", "George Mason University"))).toBeNull();
  });
});

describe("a loop's runs", () => {
  it("count what they found and spent in the last 7 days", () => {
    const db = openDb(":memory:");
    const loop = saveLoop(db, {
      name: "sweep",
      instructions: "sweep",
      schedule: { kind: "every", hours: 24 },
      budgetUsd: 1,
      enabled: true,
    });
    const thread = createThread(db, "run", loop.id).id;
    propose(db, thread, { name: "Ada", university: "GMU", sources: [], fields: { fit: 4 } });
    recordSpend(db, { threadId: thread, what: "treg", usd: 0.02, callId: "c1", feature: "loop" });
    expect(loopStats(db, loop.id)).toEqual({ found7d: 1, spend7d: 0.02 });
    expect(loopStats(db, loop.id, new Date(Date.now() + 8 * 864e5))).toEqual({
      found7d: 0,
      spend7d: 0,
    });
  });

  it("sum up a run in one line", () => {
    const add = { kind: "add" as const, status: "pending" };
    const update = { kind: "update" as const, status: "accepted" };
    expect(runSummary([add, add, update], null)).toBe("2 new, 1 change, 1 accepted");
    expect(runSummary([], null)).toBe("nothing new");
    expect(runSummary([add], "Stopped: This would pass the $0.5 cap for this loop run.")).toBe(
      "Stopped: This would pass the $0.5 cap for this loop run. · 1 new",
    );
  });
});

describe("Always under $x here", () => {
  it("lets paid calls up to the next cent go without asking, in the thread and its loop", async () => {
    const db = openDb(":memory:");
    updateSettings(db, { treg: true });
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const loop = saveLoop(db, {
      name: "sweep",
      instructions: "sweep",
      schedule: { kind: "every", hours: 24 },
      budgetUsd: 1,
      enabled: true,
    });
    const thread = createThread(db, "run", loop.id).id;
    runner.send(thread, "find health NLP professors", "send");
    const until = async (check: () => boolean) => {
      for (const start = Date.now(); !check(); await new Promise((r) => setTimeout(r, 10)))
        if (Date.now() - start > 5000) throw new Error("timed out");
    };
    await until(() => getThread(db, thread)?.status === "approval");
    const approval = listEvents(db, thread).find(
      (e): e is Extract<ThreadEvent, { type: "approval" }> => e.type === "approval",
    );
    runner.resolveApproval(approval!.id, "always");
    await until(() => getThread(db, thread)?.status === "idle");
    // $0.0245 rounds up to a $0.03 rule.
    expect(allowUnder(db, thread)).toBe(0.03);
    expect(listLoops(db).find((l) => l.id === loop.id)?.allowUnder).toBe(0.03);
  });
});
