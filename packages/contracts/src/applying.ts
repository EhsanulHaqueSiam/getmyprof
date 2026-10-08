// What applying asks of this applicant: the test scores a program wants that they don't have
// (scoreGaps, shown under each program in the Vault), and what the application fees come to
// against their fee budget (feeBudget, the Applications header).
import type { Applicant } from "./domain.ts";
import type { VaultState } from "./vault.ts";

/** Each test as program text names it, how a taken test is named, and its score scale. */
const TESTS = [
  { name: "IELTS", is: /ielts/i, min: 1, max: 9, english: true },
  { name: "TOEFL", is: /toefl/i, min: 20, max: 120, english: true },
  { name: "PTE", is: /\bpte\b/i, min: 10, max: 90, english: true },
  { name: "Duolingo", is: /duolingo|\bdet\b/i, min: 10, max: 160, english: true },
  { name: "GRE", is: /\bgre\b/i, min: 260, max: 340, english: false },
] as const;
type Test = (typeof TESTS)[number];

const NAMES = /\b(?:IELTS|TOEFL|PTE|Duolingo|GRE)\b/gi;
/** The first number in `text` on this test's scale, e.g. 6.5 for IELTS; a year never counts. */
const scoreIn = (text: string, t: Test) =>
  [...text.matchAll(/\b\d{1,3}(?:\.\d+)?\b/g)].map(Number).find((n) => n >= t.min && n <= t.max);

/**
 * The minimum each test needs, read from program text: "IELTS 6.5", "TOEFL iBT 90", "minimum
 * TOEFL of 100", "IELTS 7.0 overall". A number counts for the test named just before it, so
 * "TOEFL 90 or IELTS 6.5" reads both; "GRE optional" sets none.
 */
function minimums(text: string) {
  const named = [...text.matchAll(NAMES)];
  return TESTS.flatMap((test) => {
    for (const [i, m] of named.entries()) {
      if (!test.is.test(m[0])) continue;
      const from = m.index + m[0].length;
      const after = text.slice(from, Math.min(named[i + 1]?.index ?? text.length, from + 40));
      if (/optional|not required|waived/i.test(after)) return [];
      const min = scoreIn(after, test);
      if (min !== undefined) return [{ test, min }];
    }
    return [];
  });
}

/** An English rule that takes a medium-of-instruction certificate in place of a test. */
const takesMoi = (text: string) =>
  /\bMOI\b|medium[- ]of[- ]instruction/i.test(text) &&
  /accept|waive/i.test(text) &&
  !/not accept|no MOI/i.test(text);

/**
 * What a program's test rules need that the applicant doesn't have, one line each: "needs IELTS
 * 7.0, you have 6.5", "needs TOEFL 100, none taken". One English test that meets its minimum is
 * enough, and so is an MOI certificate where the program takes one. Booked tests aren't scores;
 * a taken one whose score can't be read gives no line, since nothing is known either way.
 */
export function scoreGaps(english: string, applicant: Pick<Applicant, "tests" | "moi">) {
  // IELTS bands read with one decimal, as score reports print them.
  const shown = (v: number | null, name: string) =>
    v !== null && name === "IELTS" ? v.toFixed(1) : String(v);
  const needs = minimums(english).map((n) => {
    const tests = applicant.tests.filter((x) => x.status === "taken" && n.test.is.test(x.name));
    const scores = tests.flatMap((x) => scoreIn(x.score, n.test) ?? []);
    return { ...n, taken: tests.length > 0, best: scores.length ? Math.max(...scores) : null };
  });
  // Met, or taken with a score that can't be read: no gap to report.
  const fine = (n: (typeof needs)[number]) => n.taken && (n.best === null || n.best >= n.min);
  const lines: string[] = [];
  const languages = needs.filter((n) => n.test.english);
  if (languages.length && !(applicant.moi && takesMoi(english)) && !languages.some(fine)) {
    const short = languages.filter((n) => n.taken);
    for (const n of short)
      lines.push(
        `needs ${n.test.name} ${shown(n.min, n.test.name)}, you have ${shown(n.best, n.test.name)}`,
      );
    if (!short.length)
      lines.push(
        `needs ${languages.map((n) => `${n.test.name} ${shown(n.min, n.test.name)}`).join(" or ")}, none taken`,
      );
  }
  for (const n of needs.filter((x) => !x.test.english && !fine(x)))
    lines.push(`needs ${n.test.name} ${n.min}, ${n.taken ? `you have ${n.best}` : "none taken"}`);
  return lines;
}

/** A fee in US dollars: "$75", "US$75", "USD 90", "75 USD"; 0 for none; null if not in dollars. */
export function usdFee(fee: string) {
  // "C$", "A$" and "HK$" are other dollars.
  const m =
    /(?:\bUS\$|(?<![A-Za-z])\$|\bUSD\s*)(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*USD\b/i.exec(
      fee,
    );
  const amount = m?.[1] ?? m?.[2];
  if (amount !== undefined) return Number(amount.replaceAll(",", ""));
  return /\b(?:none|free|no (?:application )?fee)\b/i.test(fee) ? 0 : null;
}

/**
 * What the application fees come to, in USD, against the applicant's fee budget. Rejected and
 * declined applications drop out; a granted waiver is free, and one marked "only if waived" isn't
 * paid until its waiver is granted. `pending` counts waivers asked for and not yet answered.
 * Fees not in dollars are listed in `unknown`, never guessed.
 */
export function feeBudget(v: VaultState, applicant: Pick<Applicant, "feeBudgetUsd">) {
  let spent = 0;
  let waived = 0;
  let pending = 0;
  const unknown: string[] = [];
  for (const a of v.applications) {
    const p = v.programs.find((x) => x.id === a.programId);
    if (!p || a.status === "rejected" || a.status === "declined") continue;
    if (a.waiver === "requested") pending++;
    const fee = usdFee(p.fee);
    if (fee === null) unknown.push(`${p.university}: ${p.fee || "?"}`);
    else if (a.waiver === "granted") waived += fee;
    else if (!a.onlyIfWaived) spent += fee;
  }
  const budget = applicant.feeBudgetUsd;
  return { spent, waived, pending, unknown, budget, over: budget !== null && spent > budget };
}
