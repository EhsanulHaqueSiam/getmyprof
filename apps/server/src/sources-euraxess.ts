// EURAXESS, the EU's research jobs portal, by country: its keyword search sits behind an antibot
// form, but its facet links (country, researcher profile) are plain pages. A search reads the
// newest first-stage (R1, PhD-level) posts in each of the hunt's countries and keeps those naming
// a term. The parsers are pure and tested on a saved page.
import { COUNTRIES, placeCountries } from "@getmyprof/contracts";
import {
  EURAXESS_COUNTRIES,
  getText,
  mentions,
  narrow,
  payKind,
  phdLevel,
  type PositionQuery,
  type RawPosition,
  strip,
} from "./sources-positions.ts";

const SEARCH = "https://euraxess.ec.europa.eu/jobs/search";
/** The researcher-profile facet for first-stage researchers: doctoral candidates. */
const R1 = "447";
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/** The country facet's options as ISO code to EURAXESS id: "Czech Republic" is cz, 747. */
export function parseEuraxessCountries(html: string) {
  const select = /id="edit-job-country--2"[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
  return new Map(
    [...select.matchAll(/value="(\d+)"\s*>([^<]+)</g)].flatMap(([, id, name]) => {
      const [code] = placeCountries([name ?? ""], false);
      return code && id ? [[code, id] as const] : [];
    }),
  );
}

/** "16 October 2026" as "2026-10-16". */
const longDate = (s: string) => {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(s);
  const month = MONTHS.indexOf((m?.[2] ?? "").toLowerCase());
  return m && month >= 0
    ? `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1]?.padStart(2, "0")}`
    : null;
};

/** The result cards on a EURAXESS search page: doctoral posts only (R1 also lists assistants). */
export function parseEuraxess(html: string, country: string): RawPosition[] {
  return [...html.matchAll(/<article class="ecl-content-item">([\s\S]*?)<\/article>/g)].flatMap(
    ([, card = ""]) => {
      const link = /href="\/jobs\/(\d+)"[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(card);
      const title = strip(link?.[2] ?? "");
      if (!link?.[1] || !phdLevel(title)) return [];
      // "Lund University via MyNetwork": the host, not the board that reposted it; a board's own
      // name ("Academic Positions") gives way to the work location's institution.
      const host = strip(/primary-meta-item"><a[^>]*>([^<]+)<\/a>/.exec(card)?.[1] ?? "").replace(
        /\s+via\s.*$/,
        "",
      );
      const place = strip(/Number of offers:[^,]*,[^,]*,([^,<]+)/.exec(card)?.[1] ?? "");
      const teaser = strip(/__description">([\s\S]*?)<\/div>/.exec(card)?.[1] ?? "");
      const program = strip(
        /id-Funding-Programme[\s\S]*?aria-label="Filter by ([^"]+)"/.exec(card)?.[1] ?? "",
      );
      const fields = [
        ...card.matchAll(/job_research_field[^"]*" aria-label="Filter by ([^"]+)"/g),
      ].map((f) => f[1]);
      return [
        {
          source: "EURAXESS" as const,
          id: link[1],
          title,
          professor: "",
          university: !host || /academic ?positions|euraxess|jobs/i.test(host) ? place : host,
          country,
          funding: /not funded by a eu/i.test(program) ? "" : program,
          kind: payKind(`${title} ${teaser}`),
          deadline: /<time datetime="(\d{4}-\d\d-\d\d)/.exec(card)?.[1] ?? null,
          posted: longDate(/Posted on:\s*([^<]+)/.exec(card)?.[1] ?? ""),
          url: `https://euraxess.ec.europa.eu/jobs/${link[1]}`,
          abstract: [fields.join(", "), teaser].filter(Boolean).join(". ").slice(0, 600),
        },
      ];
    },
  );
}

let countries: Promise<Map<string, string>> | null = null;

/** Pages read in the last half hour, by URL: one search per school asks for the same pages. */
const pages = new Map<string, { at: number; posts: Promise<RawPosition[]> }>();
const HALF_HOUR = 30 * 60_000;

function page(url: string, country: string) {
  const hit = pages.get(url);
  if (hit && Date.now() - hit.at < HALF_HOUR) return hit.posts;
  const posts = getText(url).then((html) => parseEuraxess(html, country));
  pages.set(url, { at: Date.now(), posts });
  posts.catch(() => pages.delete(url));
  return posts;
}

/**
 * The newest R1 posts in each of the hunt's European countries without a board of their own,
 * naming a term. shortcut: the first six such countries, three pages (30 posts) each; read more
 * if hunts miss posts.
 */
export async function euraxessPositions(q: PositionQuery): Promise<RawPosition[]> {
  // A page that parses to no countries (changed markup, a bot wall) isn't kept.
  countries ??= getText(SEARCH).then((html) => {
    const ids = parseEuraxessCountries(html);
    if (!ids.size) throw new Error("EURAXESS listed no countries");
    return ids;
  });
  const ids = await countries.catch((e: unknown) => {
    countries = null;
    throw e;
  });
  const wanted = (q.countries ?? [])
    .filter((c) => EURAXESS_COUNTRIES.has(c) && ids.has(c))
    .slice(0, 6);
  const read = await Promise.allSettled(
    wanted.flatMap((code) =>
      [0, 1, 2].map((n) =>
        page(
          `${SEARCH}?f%5B0%5D=job_country%3A${ids.get(code)}&f%5B1%5D=job_research_profile%3A${R1}&page=${n}`,
          COUNTRIES.find((c) => c.code === code)?.name ?? code,
        ),
      ),
    ),
  );
  const found = read.flatMap((p) => (p.status === "fulfilled" ? p.value : []));
  return narrow(
    q,
    found.filter((p) => mentions(q.terms, p)),
  );
}
