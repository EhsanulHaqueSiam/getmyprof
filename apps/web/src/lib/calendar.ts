// The Calendar page's list: deadlines() narrowed by the segment filter and grouped by week, then
// by month, each row with its days-left text and the Vault section it lives in.
import type { Deadline, DeadlineKind } from "@getmyprof/contracts";
import { daysLeft, due } from "./vault";

/** The segment filter, in order. Interviews and documents only show under All. */
export const FILTERS = [
  { label: "All", kinds: null },
  { label: "Programs", kinds: ["program"] },
  { label: "Money", kinds: ["waiver", "scholarship", "offer"] },
  { label: "Tests", kinds: ["test"] },
  { label: "Letters", kinds: ["letters"] },
] as const satisfies readonly { label: string; kinds: readonly DeadlineKind[] | null }[];
export type CalendarFilter = (typeof FILTERS)[number]["label"];

/** Where each kind lives in the Vault, for its Open link. Tests live in setup, so they have none. */
export const SECTION = {
  program: "programs",
  waiver: "programs",
  scholarship: "scholarships",
  test: null,
  letters: "applications",
  interview: "applications",
  offer: "offers",
  document: "documents",
} as const satisfies Record<DeadlineKind, string | null>;

export type CalendarRow = Deadline & {
  /** "Oct 14". */
  day: string;
  /** "in 5 days", "today", "3 days ago". */
  due: string;
  /** Due within a week: shown in the warning tone. */
  soon: boolean;
};

const short = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
// A bare YYYY-MM-DD is a calendar day: read at local noon so it never shows a day early.
const local = (date: string) => new Date(`${date}T12:00:00`);

/** "Oct 5 to 11", or "Oct 26 to Nov 1" across a month. */
function week(monday: Date) {
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return `${short(monday)} to ${sunday.getMonth() === monday.getMonth() ? sunday.getDate() : short(sunday)}`;
}

/**
 * The page's groups for `items` in date order (as deadlines() returns them): "Earlier" for
 * anything before this week, "This week" and "Next week" (weeks start Monday), then one group
 * per month, with the year once it isn't this one.
 */
export function calendarGroups(items: Deadline[], filter: CalendarFilter, now = new Date()) {
  const kinds: readonly DeadlineKind[] | null =
    FILTERS.find((f) => f.label === filter)?.kinds ?? null;
  const sinceMonday = (now.getDay() + 6) % 7;
  const monday = (weeks: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday + 7 * weeks);
  const groups: { label: string; rows: CalendarRow[] }[] = [];
  for (const d of items) {
    if (kinds && !kinds.includes(d.kind)) continue;
    const days = daysLeft(d.date, now);
    const weeks = Math.floor((days + sinceMonday) / 7);
    const at = local(d.date);
    const label =
      weeks < 0
        ? "Earlier"
        : weeks === 0
          ? `This week · ${week(monday(0))}`
          : weeks === 1
            ? `Next week · ${week(monday(1))}`
            : at.toLocaleDateString("en-US", {
                month: "long",
                ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
              });
    const row = { ...d, day: short(at), due: due(d.date, now), soon: days >= 0 && days <= 7 };
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}
