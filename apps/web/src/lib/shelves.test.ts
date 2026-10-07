import type { ThreadSummary } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { shelves } from "./shelves.ts";

const t = (id: string, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  title: id,
  status: "idle",
  unread: false,
  settledAt: null,
  snoozedUntil: null,
  workingSince: null,
  scope: [],
  detail: null,
  updatedAt: "2026-10-07T10:00:00.000Z",
  spendUsd: 0,
  spendDayUsd: 0,
  loopId: null,
  pendingReview: 0,
  rows: 0,
  ...patch,
});

describe("shelves", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z");

  it("puts what needs you first, working on its own shelf, and hides snoozed and settled", () => {
    const s = shelves(
      [
        t("old", { updatedAt: "2026-10-07T11:00:00.000Z" }),
        t("approval", { status: "approval", updatedAt: "2026-10-01T00:00:00.000Z" }),
        t("working", { status: "working" }),
        t("snoozed", { snoozedUntil: "2026-10-08T09:00:00.000Z" }),
        t("woke", { snoozedUntil: "2026-10-07T09:00:00.000Z" }),
        t("settled", { settledAt: "2026-10-07T08:00:00.000Z", status: "working" }),
      ],
      now,
    );
    expect(s.main.map((x) => x.id)).toEqual(["approval", "old", "woke"]);
    expect(s.working.map((x) => x.id)).toEqual(["working"]);
    expect(s.snoozed.map((x) => x.id)).toEqual(["snoozed"]);
    expect(s.settled.map((x) => x.id)).toEqual(["settled"]);
  });
});
