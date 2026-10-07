import type { ThreadSummary } from "@gradcode/contracts";

export type Shelves = {
  main: ThreadSummary[];
  working: ThreadSummary[];
  snoozed: ThreadSummary[];
  settled: ThreadSummary[];
};

const needsYou = (t: ThreadSummary) =>
  t.status === "approval" || t.status === "input" || t.status === "failed" || t.unread;

/**
 * Sorts threads into the sidebar's shelves, T3 Code style: what needs you first, working
 * threads on their own shelf (they recede), then snoozed and settled, both collapsed by default.
 */
export function shelves(threads: ThreadSummary[], nowMs = Date.now()): Shelves {
  const out: Shelves = { main: [], working: [], snoozed: [], settled: [] };
  for (const t of threads) {
    if (t.settledAt) out.settled.push(t);
    else if (t.snoozedUntil && new Date(t.snoozedUntil).getTime() > nowMs) out.snoozed.push(t);
    else if (t.status === "working") out.working.push(t);
    else out.main.push(t);
  }
  out.main.sort(
    (a, b) => Number(needsYou(b)) - Number(needsYou(a)) || b.updatedAt.localeCompare(a.updatedAt),
  );
  out.snoozed.sort((a, b) => (a.snoozedUntil ?? "").localeCompare(b.snoozedUntil ?? ""));
  out.settled.sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""));
  return out;
}

/** Snooze presets: later today, tomorrow morning, next Monday. */
export function snoozePresets(now = new Date()) {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const tonight = at(0, 19);
  const monday = at((8 - now.getDay()) % 7 || 7, 9);
  return [
    ...(tonight > now ? [{ label: "This evening", until: tonight }] : []),
    { label: "Tomorrow morning", until: at(1, 9) },
    { label: "Next Monday", until: monday },
  ];
}
