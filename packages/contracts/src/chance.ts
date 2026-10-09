// A program's chance for this applicant: a band (reach, match, likely) with the evidence behind
// it, never a percentage. Inputs are the program's own published numbers, the applicant's
// confirmed facts and scores, and what professors there said. The Vault's Programs table shows
// the band; an application shows the requirement lines.
import { scoreGaps } from "./applying.ts";
import {
  type Applicant,
  factStatus,
  type Professor,
  type ProfileFact,
  sameSchool,
} from "./domain.ts";
import type { Program } from "./vault.ts";

export type Band = "reach" | "match" | "likely";

/** One requirement against the applicant: what the program asks, what they have, and how it reads. */
export type Requirement = {
  what: string;
  program: string;
  you: string;
  status: "meets" | "short" | "unknown" | "high" | "gap" | "strong";
};

/** The first number in "3.0 / 4.0" and the scale after the slash; null when it can't be read. */
function gpaOf(text: string) {
  const m = /(\d+(?:\.\d+)?)\s*(?:\/|out of|on a)\s*(\d+(?:\.\d+)?)/i.exec(text);
  return m ? { value: Number(m[1]), scale: Number(m[2]) } : null;
}

/** The first percentage in "7% of PhD applicants, 2025". */
const percentOf = (text: string) => {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  return m ? Number(m[1]) : null;
};

/**
 * The band and the lines behind it. Reach: a hard gap (a test score or GPA short of the
 * program's minimum, or not eligible), or a program admitting under 10% with no professor there
 * having replied. Likely: a professor there replied that they take students, and no gap. Match:
 * everything between. A GPA on another scale is never converted: it reads unknown.
 */
export function programChance(
  p: Program,
  ctx: {
    applicant: Applicant | undefined;
    facts: ProfileFact[];
    /** The sheet; the professors at this program's school are its faculty signal. */
    records: Professor[];
  },
) {
  const lines: Requirement[] = [];
  const moves: string[] = [];

  const gaps = ctx.applicant && p.english ? scoreGaps(p.english, ctx.applicant) : [];
  if (p.english)
    lines.push({
      what: "English",
      program: p.english,
      you: gaps.length
        ? gaps.join("; ")
        : (ctx.applicant?.tests
            .filter((t) => t.status === "taken")
            .map((t) => `${t.name} ${t.score}`)
            .join(", ") ??
            "") ||
          (ctx.applicant?.moi ? "MOI" : "none taken"),
      status: gaps.length ? "short" : "meets",
    });
  for (const g of gaps) moves.push(g.replace(/, you have .*|, none taken/, ""));

  const min = gpaOf(p.gpaMin);
  const gpa = ctx.applicant?.gpa ? Number(ctx.applicant.gpa) : null;
  const scale = ctx.applicant?.gpaScale ? Number(ctx.applicant.gpaScale) : null;
  if (p.gpaMin) {
    const comparable = min && gpa !== null && scale !== null && scale === min.scale;
    lines.push({
      what: "GPA",
      program: `${p.gpaMin} minimum`,
      you:
        gpa !== null
          ? `${ctx.applicant?.gpa}${scale ? ` / ${ctx.applicant?.gpaScale}` : ""}`
          : "not set",
      // No GPA on file is a gap to fill; one on another scale can't be compared.
      status:
        gpa === null ? "gap" : comparable ? (gpa >= min.value ? "meets" : "short") : "unknown",
    });
    if (comparable && gpa < min.value)
      moves.push("ask whether they consider a GPA below their minimum");
  }

  const papers = ctx.facts.filter((f) => f.kind === "paper" && factStatus(f) === "confirmed");
  lines.push({
    what: "Research",
    program: "papers help most for a PhD",
    you: papers.length
      ? `${papers.length} paper${papers.length === 1 ? "" : "s"} confirmed`
      : "no paper confirmed",
    status: papers.length ? "meets" : "gap",
  });

  const rate = percentOf(p.admitRate);
  if (p.admitRate)
    lines.push({
      what: "Selectivity",
      program: p.admitRate,
      you: "",
      status: rate !== null && rate < 10 ? "high" : "meets",
    });

  const here = ctx.records.filter((r) => sameSchool(r.university, p.university));
  const replied = here.filter((r) => /^yes\b/i.test(r.taking) && /they replied/i.test(r.taking));
  const open = here.filter((r) => /^yes\b/i.test(r.taking) || r.moneyTier === 1);
  lines.push({
    what: "Faculty interest",
    program: "a professor who wants you is the strongest signal",
    you: replied.length
      ? `${replied.map((r) => r.name).join(", ")} replied: taking`
      : open.length
        ? `${open.map((r) => r.name).join(", ")}: taking or a funded opening, no reply yet`
        : here.length
          ? `${here.length} in your sheet, none taking yet`
          : "nobody there in your sheet",
    status: replied.length ? "strong" : open.length ? "meets" : "gap",
  });
  if (!replied.length) moves.push("a reply from a professor there with money");

  const notEligible = p.eligibility.startsWith("no");
  const short = lines.some((l) => l.status === "short") || notEligible;
  const band: Band =
    short || (rate !== null && rate < 10 && !replied.length)
      ? "reach"
      : replied.length
        ? "likely"
        : "match";
  return { band, lines, moves: notEligible ? [] : moves };
}
