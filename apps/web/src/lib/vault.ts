// What the Vault shows: which scholarships fit, and what's coming up.
import {
  type Applicant,
  type Degree,
  LETTERS,
  type Offer,
  type Scholarship,
  type VaultState,
} from "@getmyprof/contracts";

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
export function comingUp(
  v: VaultState,
  now = new Date(),
  applicant?: Pick<Applicant, "tests" | "moi">,
): Upcoming[] {
  const out: Upcoming[] = [];
  // Programs that name an English test, while no score is on file and no MOI certificate.
  const asking = v.programs.filter((p) => /IELTS|TOEFL|PTE|Duolingo/i.test(p.english));
  const scored = applicant?.tests.some((t) => t.status === "taken" && t.score.trim());
  if (applicant && asking.length && !scored && !applicant.moi)
    out.push({
      id: "english-score",
      days: 0,
      urgent: true,
      text: `${asking.length} program${asking.length === 1 ? " asks" : "s ask"} for an English test score and none is on file`,
    });
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
  // A test booked for after a deadline can't count for that program.
  for (const t of applicant?.tests ?? []) {
    if (t.status === "taken" || !t.date) continue;
    for (const p of v.programs)
      if (p.deadline && t.date > p.deadline && daysLeft(p.deadline, now) >= 0)
        out.push({
          id: `late-${t.name}-${p.id}`,
          days: daysLeft(p.deadline, now),
          urgent: true,
          text: `${t.name} on ${t.date} lands after ${p.university}'s deadline, ${p.deadline}`,
        });
  }
  // Letters take weeks: six weeks out, ask your recommenders. Most programs want three.
  for (const a of v.applications) {
    const p = v.programs.find((x) => x.id === a.programId);
    if (!p?.deadline || !["planning", "in-progress"].includes(a.status)) continue;
    const days = daysLeft(p.deadline, now);
    const asked = a.recommenders.filter((r) => r.status !== "to-ask").length;
    if (days >= 0 && days <= 42 && asked < LETTERS)
      out.push({
        id: `letters-${a.id}`,
        days,
        urgent: days <= 21,
        text: `${p.university}: ask your recommenders now, ${asked} of ${LETTERS} asked, letters due ${due(p.deadline, now)}`,
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
  for (const a of v.applications) {
    const p = v.programs.find((x) => x.id === a.programId);
    for (const i of a.interviews) {
      const days = daysLeft(i.at.slice(0, 10), now);
      if (days >= 0 && days <= 14)
        out.push({
          id: i.id,
          days,
          urgent: days <= 2,
          text: `Interview with ${i.with}${p ? ` (${p.university})` : ""} ${due(i.at.slice(0, 10), now)}`,
        });
    }
  }
  for (const o of v.offers) {
    if (!o.respondBy || o.status === "accepted" || o.status === "declined") continue;
    const days = daysLeft(o.respondBy, now);
    if (days <= 30)
      out.push({
        id: o.id,
        days,
        urgent: days <= 7,
        text: `Answer ${o.university}'s offer ${due(o.respondBy, now)}`,
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

/** A year of stipend minus a year of rent, in the offer's currency; null until both are known. */
// ponytail: a family home as 1.4 times a 1-bedroom, the usual US ratio; per-city ratios if it misleads.
const FAMILY_RENT = 1.4;

/** A year's stipend minus a year's rent; with dependents, rent for a family home. */
export function leftAfterRent(
  o: Pick<Offer, "stipend" | "stipendPer" | "rentPerMonth">,
  family = false,
) {
  if (o.stipend == null || o.rentPerMonth == null) return null;
  const rent = o.rentPerMonth * (family ? FAMILY_RENT : 1);
  return (o.stipendPer === "month" ? o.stipend * 12 : o.stipend) - Math.round(rent * 12);
}

/** A calendar file for one interview: floating local time, 45 minutes. */
export function interviewIcs(i: { id: string; with: string; at: string }, where: string) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const local = i.at.replace(/[-:]/g, "").slice(0, 13).padEnd(15, "0");
  const [date = "", time = "0000"] = i.at.split("T");
  const end = new Date(`${date}T${time}:00Z`);
  end.setUTCMinutes(end.getUTCMinutes() + 45);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//getmyprof//interview//EN",
    "BEGIN:VEVENT",
    `UID:${i.id}@getmyprof`,
    `DTSTAMP:${stamp(new Date())}Z`,
    `DTSTART:${local}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:Interview with ${i.with}`,
    `LOCATION:${where}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
