// Data sources the agent and the Funding view use. NSF, NIH RePORTER and OpenAlex are free
// public APIs; treg is paid, so only endpoints with a known price may be called.
import type { Award } from "@gradcode/contracts";
import * as NodeChild from "node:child_process";

const TIMEOUT_MS = 20_000;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (v == null ? "" : String(v));

/** First day of an intake like "Fall 2027" (Sep 1) or "Spring 2028" (Jan 15). */
export function intakeStart(intake: string): Date | null {
  const year = Number(/\b(20\d\d)\b/.exec(intake)?.[1]);
  if (!year) return null;
  const season = intake.toLowerCase();
  if (season.includes("spring") || season.includes("winter"))
    return new Date(Date.UTC(year, 0, 15));
  if (season.includes("summer")) return new Date(Date.UTC(year, 5, 1));
  return new Date(Date.UTC(year, 8, 1));
}

/** Whole months an award still runs after the intake starts. Negative when it ends before. */
export function monthsAfter(ends: string | null, start: Date | null) {
  if (!ends || !start) return null;
  const end = new Date(ends);
  if (Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / (30.44 * 864e5));
}

/** NSF's "MM/DD/YYYY" to ISO "YYYY-MM-DD". */
const nsfDate = (d: unknown) => {
  const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(text(d));
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

const toNsfDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

type AwardQuery = { terms: string[]; university?: string; pi?: string; activeAfter?: string };
type RawAward = Omit<Award, "monthsAfterIntake" | "inSheet">;

export async function nsfAwards(q: AwardQuery): Promise<RawAward[]> {
  const out = new Map<string, RawAward>();
  for (const term of q.terms.length ? q.terms : [""]) {
    const params = new URLSearchParams({
      printFields:
        "id,title,piFirstName,piLastName,awardeeName,startDate,expDate,estimatedTotalAmt,abstractText",
      rpp: "25",
    });
    if (term) params.set("keyword", `"${term}"`);
    if (q.university) params.set("awardeeName", `"${q.university}"`);
    if (q.pi) params.set("pdPIName", q.pi);
    if (q.activeAfter) params.set("expDateStart", toNsfDate(q.activeAfter));
    const body = asRecord(await getJson(`https://api.nsf.gov/services/v1/awards.json?${params}`));
    for (const a of asArray(asRecord(body.response).award).map(asRecord)) {
      const id = text(a.id);
      out.set(id, {
        source: "NSF",
        id,
        title: text(a.title),
        pi: `${text(a.piFirstName)} ${text(a.piLastName)}`.trim(),
        university: text(a.awardeeName),
        usd: a.estimatedTotalAmt == null ? null : Number(a.estimatedTotalAmt),
        starts: nsfDate(a.startDate),
        ends: nsfDate(a.expDate),
        abstract: text(a.abstractText).slice(0, 600),
      });
    }
  }
  return [...out.values()];
}

export async function nihAwards(q: AwardQuery): Promise<RawAward[]> {
  const criteria: Record<string, unknown> = {};
  if (q.terms.length)
    criteria.advanced_text_search = {
      operator: "or",
      search_field: "projecttitle,terms,abstracttext",
      search_text: q.terms.join(" "),
    };
  if (q.university) criteria.org_names = [q.university];
  if (q.pi) criteria.pi_names = [{ any_name: q.pi }];
  if (q.activeAfter) criteria.project_end_date = { from_date: q.activeAfter };
  const body = asRecord(
    await getJson("https://api.reporter.nih.gov/v2/projects/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        criteria,
        include_fields: [
          "ProjectNum",
          "ProjectTitle",
          "ProjectStartDate",
          "ProjectEndDate",
          "AwardAmount",
          "Organization",
          "ContactPiName",
          "AbstractText",
        ],
        limit: 25,
      }),
    }),
  );
  const seen = new Set<string>();
  return asArray(body.results)
    .map(asRecord)
    .flatMap((r) => {
      const id = text(r.project_num);
      const core = id.slice(1, 12); // one row per project, not per fiscal year
      if (seen.has(core)) return [];
      seen.add(core);
      return [
        {
          source: "NIH" as const,
          id,
          title: text(r.project_title),
          pi: text(r.contact_pi_name),
          university: text(asRecord(r.organization).org_name),
          usd: r.award_amount == null ? null : Number(r.award_amount),
          starts: text(r.project_start_date).slice(0, 10) || null,
          ends: text(r.project_end_date).slice(0, 10) || null,
          abstract: text(r.abstract_text).slice(0, 600),
        },
      ];
    });
}

export type Author = {
  name: string;
  institution: string;
  works: number;
  citations: number;
  topics: string[];
  recent: { title: string; year: number; link: string }[];
};

export async function openAlexAuthor(name: string, university?: string): Promise<Author | null> {
  const found = asArray(
    asRecord(
      await getJson(
        `https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per-page=8`,
      ),
    ).results,
  ).map(asRecord);
  const inst = (a: Record<string, unknown>) =>
    asArray(a.last_known_institutions)
      .map((i) => text(asRecord(i).display_name))
      .join(", ");
  const want =
    university
      ?.toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3) ?? [];
  const pick =
    found.find((a) => want.length === 0 || want.some((w) => inst(a).toLowerCase().includes(w))) ??
    null;
  if (!pick) return null;
  const authorId = text(pick.id).split("/").pop();
  const works = asArray(
    asRecord(
      await getJson(
        `https://api.openalex.org/works?filter=author.id:${authorId}&sort=publication_date:desc&per-page=5`,
      ),
    ).results,
  ).map(asRecord);
  return {
    name: text(pick.display_name),
    institution: inst(pick),
    works: Number(pick.works_count ?? 0),
    citations: Number(pick.cited_by_count ?? 0),
    topics: asArray(pick.topics)
      .slice(0, 5)
      .map((t) => text(asRecord(t).display_name)),
    recent: works.map((w) => ({
      title: text(w.title),
      year: Number(w.publication_year ?? 0),
      link: text(w.doi) || text(asRecord(w.primary_location).landing_page_url),
    })),
  };
}

/** treg endpoints gradcode may call, with their price per call in USD. */
export const TREG_PRICES: Record<string, number> = {
  "tinyfish.web.search": 0,
  "anyapi.x.search.posts": 0.0006,
  "anyapi.google.scholar": 0.001,
  "millionverifier.people.email.verify": 0.0018,
  "bounceban.people.email.verify": 0.004,
  "treg.people.email.find": 0.005,
  "exa.web.answer": 0.005,
  "exa.people.search": 0.007,
  "prospeo.people.email.find": 0.0245,
};

/** One treg call through its CLI (the credential is injected server-side by treg). */
export function tregCall(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    NodeChild.execFile(
      "treg",
      ["--json", "call", endpoint, "--data", JSON.stringify(data)],
      { timeout: 120_000 },
      (err, stdout) => {
        if (err) return reject(new Error(`treg ${endpoint}: ${err.message.slice(0, 200)}`));
        try {
          resolve(asRecord(JSON.parse(stdout)).result ?? null);
        } catch {
          reject(new Error(`treg ${endpoint}: unreadable output`));
        }
      },
    );
  });
}
