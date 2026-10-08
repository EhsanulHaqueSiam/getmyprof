// Every dated step of the hunt in one list, soonest first: program deadlines, the dates to ask
// for fee waivers and letters, scholarship rounds, tests, interviews, offers and expiring
// documents. The calendar feed (GET /api/calendar.ics) carries it; the Vault's "Coming up"
// (apps/web/src/lib/vault.ts comingUp) is the short window of it that needs action now.
import type { Applicant } from "./domain.ts";
import type { VaultState } from "./vault.ts";

export type DeadlineKind =
  | "program"
  | "waiver"
  | "scholarship"
  | "test"
  | "letters"
  | "interview"
  | "offer"
  | "document";

/** One dated item. `id` is stable across calls, so a calendar updates an event in place. */
export type Deadline = {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  kind: DeadlineKind;
  title: string;
  detail: string;
  url: string;
};

// ponytail: most programs ask for three letters; store a per-program count if one asks otherwise.
export const LETTERS = 3;
/** Letters take weeks: ask recommenders six weeks before the deadline. */
const LETTERS_LEAD = 42;
/** A waiver on request takes an email and an answer: ask three weeks before. */
const WAIVER_LEAD = 21;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ON_REQUEST = /\b(?:on|upon|by) request\b/i;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** A YYYY-MM-DD date moved by whole days. */
function shift(date: string, days: number) {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The hunt's dated items, sorted by date. An ask-by date already past moves to today while the
 * deadline behind it is still ahead, and drops once that deadline has passed; everything else
 * keeps its date, past or not.
 */
export function deadlines(
  v: VaultState,
  applicant: Pick<Applicant, "tests"> | undefined,
  now = new Date(),
): Deadline[] {
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
  /** An ask-by date `lead` days before `deadline`: today if that has passed, null once it's too late. */
  const askBy = (deadline: string, lead: number) =>
    !ISO.test(deadline) || deadline < today
      ? null
      : shift(deadline, -lead) < today
        ? today
        : shift(deadline, -lead);
  const out: Deadline[] = [];

  for (const p of v.programs) {
    if (!p.deadline) continue;
    const app = v.applications.find((a) => a.programId === p.id);
    const left = app?.documents.filter((d) => !d.done).length ?? 0;
    out.push({
      id: `program-${p.id}`,
      date: p.deadline,
      kind: "program",
      title: `${p.university} · ${p.name} due`,
      detail: [
        app ? app.status.replace("-", " ") : "no application yet",
        left ? `${left} item${left === 1 ? "" : "s"} left` : "",
        p.fee && `fee ${p.fee}`,
      ]
        .filter(Boolean)
        .join(" · "),
      url: p.url,
    });
    const date = askBy(p.deadline, WAIVER_LEAD);
    if (date && ON_REQUEST.test(p.waiver) && app?.waiver !== "granted" && app?.waiver !== "denied")
      out.push({
        id: `waiver-${p.id}`,
        date,
        kind: "waiver",
        title: `Ask ${p.university} for a fee waiver`,
        detail: `Waiver ${p.waiver}; fee ${p.fee || "?"}, deadline ${p.deadline}`,
        url: p.url,
      });
  }

  for (const s of v.scholarships) {
    if (!s.deadline || (s.status !== "watch" && s.status !== "applying")) continue;
    out.push({
      id: `scholarship-${s.id}`,
      date: s.deadline,
      kind: "scholarship",
      title: `${s.name} closes`,
      detail: [s.sponsor, s.amount, s.status].filter(Boolean).join(" · "),
      url: s.url,
    });
  }

  for (const t of applicant?.tests ?? []) {
    if ((t.status !== "booked" && t.status !== "planned") || !t.date) continue;
    // A test after a deadline can't count for that program.
    const late = v.programs.filter((p) => p.deadline && t.date > p.deadline);
    out.push({
      id: `test-${slug(t.name)}-${t.date}`,
      date: t.date,
      kind: "test",
      title: `${t.name}${t.status === "planned" ? " (planned)" : ""}`,
      detail: late.length
        ? `Lands after ${late.map((p) => `${p.university}'s deadline, ${p.deadline}`).join("; ")}`
        : "",
      url: "",
    });
  }

  for (const a of v.applications) {
    const p = v.programs.find((x) => x.id === a.programId);
    const asked = a.recommenders.filter((r) => r.status !== "to-ask").length;
    const date = p?.deadline && askBy(p.deadline, LETTERS_LEAD);
    if (p && date && (a.status === "planning" || a.status === "in-progress") && asked < LETTERS)
      out.push({
        id: `letters-${a.id}`,
        date,
        kind: "letters",
        title: `${p.university}: ask your recommenders`,
        detail: `${asked} of ${LETTERS} asked, letters due ${p.deadline}`,
        url: a.portal,
      });
    for (const i of a.interviews)
      out.push({
        id: `interview-${i.id}`,
        date: i.at.slice(0, 10),
        kind: "interview",
        title: `Interview with ${i.with}${p ? ` (${p.university})` : ""}`,
        detail: i.at.slice(11, 16) ? `at ${i.at.slice(11, 16)}` : "",
        url: "",
      });
  }

  for (const o of v.offers) {
    if (!o.respondBy || o.status === "accepted" || o.status === "declined") continue;
    out.push({
      id: `offer-${o.id}`,
      date: o.respondBy,
      kind: "offer",
      title: `Answer ${o.university}'s offer`,
      detail: o.program,
      url: "",
    });
  }

  for (const d of v.documents) {
    if (!d.expires) continue;
    out.push({
      id: `document-${d.id}`,
      date: d.expires,
      kind: "document",
      title: `${d.name} expires`,
      detail: d.kind,
      url: "",
    });
  }

  // Dates come from the agent and the applicant; one that isn't YYYY-MM-DD can't be placed.
  return out.filter((d) => ISO.test(d.date)).toSorted((a, b) => a.date.localeCompare(b.date));
}
