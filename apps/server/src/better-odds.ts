// Fields next to the applicant's where a funded admit is likelier: the money at their schools in
// each (NSF and NIH awards past the intake, citizen-only training grants apart), against their own
// field's. Setup ranks them (hunt.betterOdds); the "Fields with better odds" starter has the agent
// weigh fit, programs and admit rates on top.
import type { BetterOdds } from "@getmyprof/contracts";
import type { Sources } from "./agent/sourcing.ts";
import type { RawAward } from "./sources.ts";

/** The sources it reads: the real ones, or fixtures for the scripted agent. */
type From = Pick<Sources, "nsf" | "nih" | "adjacent">;

/** Departments next to a field family that tend to fund more students per applicant. */
const NEIGHBORS: [RegExp, Record<string, string[]>][] = [
  [
    /language|nlp|linguistic|text|speech/i,
    {
      "Health informatics": ["health informatics", "electronic health record"],
      "Biomedical informatics": ["biomedical informatics", "clinical informatics"],
      "Information science": ["information science", "misinformation"],
      "Computational social science": ["computational social science", "social media"],
      "Computational linguistics": ["computational linguistics", "speech recognition"],
    },
  ],
  [
    /machine learning|deep learning|\bml\b|neural|artificial intelligence/i,
    {
      Statistics: ["statistical learning", "biostatistics"],
      "Operations research": ["operations research", "stochastic optimization"],
      "Computational biology": ["computational biology", "bioinformatics"],
      "Health informatics": ["health informatics", "electronic health record"],
    },
  ],
  [
    /vision|image|graphics/i,
    {
      "Medical imaging": ["medical imaging", "radiology"],
      "Remote sensing": ["remote sensing", "satellite imagery"],
      "Computational biology": ["microscopy", "bioimage"],
    },
  ],
];

/** The field's own words for award search: NLP grants say "natural language" or "language model". */
const coreTerms = (fields: string[]) => [
  ...fields,
  ...(fields.some((f) => /language|nlp/i.test(f)) ? ["natural language", "language model"] : []),
];

const citizenOnly = (a: RawAward) => /^\[(T32|T90|R90) training grant/.test(a.title);

async function money(from: From, terms: string[], schools: string[], after: string) {
  const awards = (
    await Promise.all(
      schools.flatMap((university) =>
        [from.nsf, from.nih].map((f) =>
          f({ terms, university, activeAfter: after }).catch(() => []),
        ),
      ),
    )
  ).flat();
  const open = awards.filter((a) => a.pi && !citizenOnly(a));
  return {
    fundedPis: new Set(open.map((a) => a.pi.toLowerCase())).size,
    usd: open.reduce((n, a) => n + (a.amount ?? 0), 0),
    citizenOnly: awards.filter(citizenOnly).length,
  };
}

const seen = new Map<string, { at: number; odds: { core: number; fields: BetterOdds[] } }>();

/**
 * Each neighbor field's money at the schools, most funded PIs first, beside the hunt's own field.
 * Kept a day per fields and schools: some 60 free requests, about ten seconds.
 */
export async function betterOdds(from: From, fields: string[], schools: string[], after: string) {
  const key = JSON.stringify([fields, schools, after]);
  const hit = seen.get(key);
  if (hit && Date.now() - hit.at < 864e5) return hit.odds;
  const words = fields.join(" ");
  const curated = NEIGHBORS.flatMap(([re, near]) => (re.test(words) ? Object.entries(near) : []));
  // A field no family covers falls back to OpenAlex's neighbors, searched by name.
  const neighbors: [string, string[]][] = curated.length
    ? [...new Map(curated)]
    : (await from.adjacent(fields).catch(() => [])).slice(0, 4).map((t) => [t, [t]]);
  const [core, ...each] = await Promise.all([
    money(from, coreTerms(fields), schools, after),
    ...neighbors.map(([, terms]) => money(from, terms, schools, after)),
  ]);
  const odds = {
    core: core?.fundedPis ?? 0,
    fields: neighbors
      .map(([field], i) => ({ field, ...(each[i] ?? { fundedPis: 0, usd: 0, citizenOnly: 0 }) }))
      .toSorted((a, b) => b.fundedPis - a.fundedPis),
  };
  seen.set(key, { at: Date.now(), odds });
  return odds;
}
