// Next moves: what the applicant should do to get funded, ranked by date, each with why and
// where to do it. Rules over data the app already has (deadlines, test gaps, fees, replies,
// money tiers, facts); nothing here guesses. The Next moves page renders it.
import { feeBudget, scoreGaps } from "./applying.ts";
import { deadlines } from "./deadlines.ts";
import { type Applicant, factStatus, type Professor, type ProfileFact } from "./domain.ts";
import type { Conversation } from "./outreach.ts";
import type { VaultState } from "./vault.ts";

export type Lane = "Money" | "Admission" | "Profile" | "Outreach";

/** Where a move is done: a page, and for the Vault one of its sections. */
export type MoveLink =
  | { page: "pipeline" | "professors" | "calendar" }
  | { page: "vault"; section: "applications" | "scholarships" | "documents" | "facts" };

export type Move = {
  id: string;
  lane: Lane;
  title: string;
  why: string;
  /** YYYY-MM-DD: the day it should be done by. */
  by: string;
  to: MoveLink;
};

const iso = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
const plus = (d: Date, days: number) =>
  iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** How far ahead dated steps count as moves; later ones wait on the Calendar. */
const HORIZON = 60;

/**
 * The applicant's next moves, soonest first. Each is a rule over what the app knows:
 * replies to answer and drafts to approve, professors with money not yet contacted, the
 * Calendar's ask-by dates (letters, waivers) and closing scholarships, tests that land after a
 * deadline, test scores short of a program's minimum, fees over budget, facts not confirmed, and
 * no CV.
 */
export function nextMoves(
  input: {
    vault: VaultState;
    applicant: Applicant | undefined;
    facts: ProfileFact[];
    records: Professor[];
    conversations: Pick<Conversation, "turn" | "record">[];
  },
  now = new Date(),
): Move[] {
  const { vault, applicant, facts, records, conversations } = input;
  const today = iso(now);
  const moves: Move[] = [];

  for (const c of conversations.filter((x) => x.turn === "yours"))
    moves.push({
      id: `answer-${c.record.key}`,
      lane: "Outreach",
      title: `Answer ${c.record.name}`,
      why: "They wrote back. An answer is waiting in Pipeline.",
      by: today,
      to: { page: "pipeline" },
    });
  const approve = conversations.filter((x) => x.turn === "approve").length;
  if (approve)
    moves.push({
      id: "approve",
      lane: "Outreach",
      title: `Approve ${n(approve, "draft")}`,
      why: "Approved first emails go out Tuesday to Thursday at 08:00 their time.",
      by: today,
      to: { page: "pipeline" },
    });
  const withMoney = records.filter(
    (r) =>
      (r.moneyTier === 1 || r.moneyTier === 2) &&
      r.fit >= 4 &&
      r.stage === "new" &&
      !r.eligibility.startsWith("no") &&
      !/^no\b/i.test(r.taking),
  );
  if (withMoney.length)
    moves.push({
      id: "contact-money",
      lane: "Outreach",
      title: `Email ${n(withMoney.length, "professor")} who can fund you`,
      why: `${withMoney
        .slice(0, 3)
        .map((r) => r.name)
        .join(
          ", ",
        )}${withMoney.length > 3 ? " and more" : ""}: a posted opening or a grant past your intake, fit 4+, not contacted yet.`,
      by: plus(now, 3),
      to: { page: "professors" },
    });

  const horizon = plus(now, HORIZON);
  for (const d of deadlines(vault, applicant, now)) {
    if (d.date < today || d.date > horizon) continue;
    const base = { id: d.id, title: d.title, why: d.detail, by: d.date };
    if (d.kind === "letters")
      moves.push({ ...base, lane: "Admission", to: { page: "vault", section: "applications" } });
    else if (d.kind === "waiver")
      moves.push({ ...base, lane: "Money", to: { page: "vault", section: "applications" } });
    else if (d.kind === "scholarship")
      moves.push({ ...base, lane: "Money", to: { page: "vault", section: "scholarships" } });
    else if (d.kind === "test" && d.detail)
      moves.push({
        ...base,
        title: `${d.title}: too late`,
        lane: "Admission",
        to: { page: "calendar" },
      });
    else if (d.kind === "program" && /^(no application yet|planning)/.test(d.detail))
      moves.push({
        ...base,
        title: `Start: ${d.title.replace(/ due$/, "")}`,
        lane: "Admission",
        to: { page: "vault", section: "applications" },
      });
    else if (d.kind === "document")
      moves.push({ ...base, lane: "Profile", to: { page: "vault", section: "documents" } });
  }

  if (applicant)
    for (const p of vault.programs) {
      const app = vault.applications.find((a) => a.programId === p.id);
      if (app && ["rejected", "declined", "admitted"].includes(app.status)) continue;
      if (p.deadline && p.deadline < today) continue;
      for (const gap of scoreGaps(p.english, applicant))
        moves.push({
          id: `gap-${p.id}-${gap}`,
          lane: "Admission",
          title: `${p.university}: ${gap}`,
          why: p.deadline
            ? `Retake before ${p.deadline}, or drop it from your list.`
            : "Retake, or drop it from your list.",
          by: p.deadline ?? plus(now, 30),
          to: { page: "vault", section: "applications" },
        });
    }

  const fees = applicant ? feeBudget(vault, applicant) : null;
  if (fees?.over && fees.budget !== null)
    moves.push({
      id: "fees",
      lane: "Money",
      title: `Fees are $${fees.spent - fees.budget} over your budget`,
      why: `$${fees.spent} against $${fees.budget}. Mark one "only if waived", or ask for waivers.`,
      by: plus(now, 7),
      to: { page: "vault", section: "applications" },
    });

  const open = facts.filter((f) => factStatus(f) !== "confirmed" && factStatus(f) !== "planned");
  if (open.length)
    moves.push({
      id: "facts",
      lane: "Profile",
      title: `Confirm ${n(open.length, "fact")}`,
      why: "Drafts and statements cite only confirmed facts with proof.",
      by: plus(now, 3),
      to: { page: "vault", section: "facts" },
    });
  if (!vault.documents.some((d) => d.kind === "cv"))
    moves.push({
      id: "cv",
      lane: "Profile",
      title: "Add your CV",
      why: "First emails attach it, and the agent reads your facts from it.",
      by: today,
      to: { page: "vault", section: "documents" },
    });

  return moves.toSorted((a, b) => a.by.localeCompare(b.by));
}
