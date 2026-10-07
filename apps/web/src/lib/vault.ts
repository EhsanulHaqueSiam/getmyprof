// What the Vault shows: which scholarships fit, and what's coming up.
import type { Applicant, Degree, Scholarship, VaultState } from "@gradcode/contracts";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Open to the applicant's citizenship, and to a degree they're hunting. */
export function fitsMe(
  s: Scholarship,
  applicant: Pick<Applicant, "citizenship">,
  degrees: Degree[],
) {
  const citizen =
    s.citizenship.length === 0 ||
    s.citizenship.some((c) => applicant.citizenship.some((mine) => same(c, mine)));
  const track = degrees.length === 0 || s.tracks.some((t) => degrees.includes(t));
  return citizen && track;
}

/** Whole days from today until a YYYY-MM-DD date; negative once it has passed. */
export function daysLeft(date: string, now = new Date()) {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 864e5);
}

/** "in 12 days", "today", "3 days ago". */
export function due(date: string, now = new Date()) {
  const n = daysLeft(date, now);
  if (n === 0) return "today";
  if (n > 0) return `in ${n} day${n === 1 ? "" : "s"}`;
  return `${-n} day${n === -1 ? "" : "s"} ago`;
}

export type Upcoming = { id: string; text: string; urgent: boolean; days: number };

/**
 * The right panel's "Coming up": documents running out within a year, and deadlines within 45
 * days for applications with work left and scholarships the applicant is applying to.
 */
export function comingUp(v: VaultState, now = new Date()): Upcoming[] {
  const out: Upcoming[] = [];
  for (const d of v.documents) {
    if (!d.expires) continue;
    const days = daysLeft(d.expires, now);
    if (days <= 365)
      out.push({
        id: d.id,
        days,
        urgent: days <= 90,
        text: `${d.name} ${days < 0 ? "expired" : "expires"} ${due(d.expires, now)}`,
      });
  }
  for (const a of v.applications) {
    const p = v.programs.find((x) => x.id === a.programId);
    if (!p?.deadline || !["planning", "in-progress"].includes(a.status)) continue;
    const days = daysLeft(p.deadline, now);
    const left = a.documents.filter((x) => !x.done).length;
    if (days <= 45)
      out.push({
        id: a.id,
        days,
        urgent: days <= 14,
        text: `${p.university} · ${p.name} due ${due(p.deadline, now)}${left ? ` · ${left} item${left === 1 ? "" : "s"} left` : ""}`,
      });
  }
  for (const s of v.scholarships) {
    if (!s.deadline || s.status !== "applying") continue;
    const days = daysLeft(s.deadline, now);
    if (days >= 0 && days <= 45)
      out.push({
        id: s.id,
        days,
        urgent: days <= 14,
        text: `${s.name} closes ${due(s.deadline, now)}`,
      });
  }
  return out.toSorted((a, b) => a.days - b.days);
}
