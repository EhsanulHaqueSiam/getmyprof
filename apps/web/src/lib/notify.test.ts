import type { ThreadSummary } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { newlyWaiting } from "./notify";

const t = (id: string, status: ThreadSummary["status"]): ThreadSummary => ({
  id,
  title: id,
  status,
  unread: false,
  settledAt: null,
  snoozedUntil: null,
  workingSince: null,
  updatedAt: "",
  spendUsd: 0,
  spendDayUsd: 0,
  loopId: null,
  pendingReview: 0,
  rows: 0,
});

describe("desktop notifications", () => {
  it("fire only for threads that just started waiting on an Approval or an answer", () => {
    const before = [t("a", "working"), t("b", "approval"), t("c", "working")];
    const after = [t("a", "approval"), t("b", "approval"), t("c", "idle"), t("d", "input")];
    expect(newlyWaiting(before, after).map((x) => x.id)).toEqual(["a", "d"]);
  });
});
