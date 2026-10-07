// How the Writer reads a piece: which citations stand, which claims are blocked, the checks,
// and the plain text that leaves the app. Blocking is computed from each fact's status now, so
// adding proof in the Vault unblocks a claim without rewriting anything.
import { type Applicant, factStatus, type ProfileFact, type Writing } from "@gradcode/contracts";

export type Cited = { n: string; fact: ProfileFact | undefined; ok: boolean };

/** Every citation in order, with its fact and whether it can be claimed. */
export function citations(w: Writing, facts: ProfileFact[]): Cited[] {
  return Object.entries(w.citations)
    .toSorted(([a], [b]) => Number(a) - Number(b))
    .map(([n, id]) => {
      const fact = facts.find((f) => f.id === id);
      return { n, fact, ok: !!fact && factStatus(fact) === "confirmed" };
    });
}

/** "[3]" markers in the body that point at no citation at all, e.g. typed by hand. */
export const strayMarkers = (w: Writing) =>
  [...new Set([...w.body.matchAll(/\[(\d+)\]/g)].map((m) => m[1] ?? ""))].filter(
    (n) => !w.citations[n],
  );

export type Part = { key: string; text: string } | { key: string; cite: string };

/** Paragraphs of text, keyed by position: the body is static between saves. */
export const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p, i) => ({ key: `p${i}`, text: p }));

/** Paragraphs of sentences, each split into text and citation parts, blocked when it cites an unproven fact. */
export function layout(w: Writing, blocked: Set<string>) {
  return paragraphs(w.body).map((p) => ({
    key: p.key,
    sentences: p.text.split(/(?<=[.!?])\s+/).map((sentence, j) => {
      const pieces = sentence.split(/(\[\d+\])/).filter(Boolean);
      const parts = pieces.map((x, k): Part => {
        const n = /^\[(\d+)\]$/.exec(x)?.[1];
        const key = `${p.key}s${j}p${k}`;
        // "2025 [1]" renders as "2025¹": the space before a citation goes.
        const next = pieces[k + 1];
        return n ? { key, cite: n } : { key, text: next?.startsWith("[") ? x.trimEnd() : x };
      });
      return {
        key: `${p.key}s${j}`,
        parts,
        blocked: parts.some((x) => "cite" in x && blocked.has(x.cite)),
      };
    }),
  }));
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const SCORE = /\b(IELTS|TOEFL|GRE|PTE|Duolingo)\b[^.\n]{0,24}?\b\d{1,3}(\.\d)?\b/i;

/**
 * The right panel's checks. A score claim blocks export unless a taken test with a score backs
 * it; em dashes only warn.
 */
export function checks(w: Writing, ctx: { named: string[]; applicant: Applicant | undefined }) {
  const body = plainText(w);
  const hasScore = !!ctx.applicant?.tests.some((t) => t.status === "taken" && t.score.trim());
  const last = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
  return {
    pages: Math.max(0.5, Math.ceil(words(body) / 250) / 2),
    words: words(body),
    namedFound: ctx.named.filter((n) => body.includes(last(n))).length,
    namedTotal: ctx.named.length,
    scoreClaimed: SCORE.test(body) && !hasScore,
    emDashes: (body.match(/—/g) ?? []).length,
  };
}

/** The text as it leaves the app: citation markers gone, spacing tidied. */
export const plainText = (w: Writing) =>
  w.body
    .replace(/\s*\[\d+\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
