// How the Writer reads a piece: which citations stand, which claims are blocked, the checks,
// and the plain text that leaves the app. Blocking is computed from each fact's status now, so
// adding proof in the Vault unblocks a claim without rewriting anything.
import {
  type Applicant,
  factStatus,
  type ProfileFact,
  unbackedScore,
  uncitedClaims,
  type Writing,
} from "@gradcode/contracts";
import { strToU8, zipSync } from "fflate";

export { unbackedScore };

/** What each kind of piece is called in the app. */
export const WRITING_LABEL = {
  sop: "Statement of purpose",
  cv: "CV",
  essay: "Scholarship essay",
  prep: "Interview prep",
  letter: "Negotiation letter",
  note: "Note",
  visa: "Visa steps",
} as const satisfies Record<Writing["kind"], string>;

/** The heading a piece carries on paper, in the PDF and the Word file. */
export const PAPER_TITLE = {
  sop: "Statement of Purpose",
  cv: "Curriculum Vitae",
  essay: "Essay",
  prep: "Interview Preparation",
  letter: "Letter",
  note: "Note",
  visa: "Visa Steps",
} as const satisfies Record<Writing["kind"], string>;

/** Only what leaves the app has to stand on proven facts; prep packs and visa plans stay private. */
export const mustProve = (w: Writing) => w.kind !== "prep" && w.kind !== "visa";

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

/** Sentences claiming something about the applicant with no citation; they block export too. */
export const uncited = (w: Writing) => (mustProve(w) ? uncitedClaims(w.body) : []);

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

/**
 * Paragraphs of sentences, each split into text and citation parts. A sentence is blocked when it
 * cites an unproven fact, or, in a piece that must be proven, claims something and cites nothing.
 */
export function layout(w: Writing, blocked: Set<string>) {
  const claims = new Set(uncited(w));
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
        blocked:
          parts.some((x) => "cite" in x && blocked.has(x.cite)) || claims.has(sentence.trim()),
      };
    }),
  }));
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * The right panel's checks. A score claim blocks export unless a taken test with a score backs
 * it; em dashes only warn.
 */
export function checks(w: Writing, ctx: { named: string[]; applicant: Applicant | undefined }) {
  const body = plainText(w);

  const last = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
  return {
    pages: Math.max(0.5, Math.ceil(words(body) / 250) / 2),
    words: words(body),
    namedFound: ctx.named.filter((n) => body.includes(last(n))).length,
    namedTotal: ctx.named.length,
    scoreClaimed: unbackedScore(body, ctx.applicant),
    emDashes: (body.match(/—/g) ?? []).length,
  };
}

/** The text as it leaves the app: citation markers gone, spacing tidied. */
export const plainText = (w: Writing) =>
  w.body
    .replace(/\s*\[\d+\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

// Text inside Word's XML: markup escaped, control characters XML forbids dropped.
const xmlText = (s: string) =>
  s
    // oxlint-disable-next-line no-control-regex -- these are exactly the characters a .docx can't hold
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** One paragraph in 12pt Times; single newlines inside it, as in a CV, become line breaks. */
const wordParagraph = (text: string, props = "") =>
  `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>${props}<w:sz w:val="24"/></w:rPr>${text
    .split("\n")
    .map((line) => `<w:t xml:space="preserve">${xmlText(line)}</w:t>`)
    .join("<w:br/>")}</w:r></w:p>`;

/** The piece as a .docx: the same heading and plain text the PDF prints, editable in Word. */
export function docx(w: Writing) {
  const body = [
    wordParagraph(PAPER_TITLE[w.kind], "<w:b/>"),
    ...paragraphs(plainText(w)).map((p) => wordParagraph(p.text)),
  ].join("");
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    "[Content_Types].xml": strToU8(
      `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(
      `${head}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
  });
}
