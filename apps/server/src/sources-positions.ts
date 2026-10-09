// Advertised PhD positions from free boards: jobs.ac.uk (HTML search; UK studentships) and
// INSPIRE (JSON API; physics, worldwide). Each parser is pure and tested on saved markup; the
// fetchers only add the request. Euraxess renders its results in the browser behind an antibot
// form (a fetch sees the newest ten posts whatever the query), and FindAPhD and AcademicPositions
// sit behind a bot wall, so the agent finds those postings with WebSearch.
import type { Position, PositionSource } from "@getmyprof/contracts";
import { asArray, asRecord, sameSchool, text, UK_PLACES } from "./sources.ts";

const TIMEOUT_MS = 20_000;
// The boards answer a browser's User-Agent and refuse a bare one.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) getmyprof";

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

export type PositionQuery = { terms: string[]; university?: string };
export type RawPosition = Omit<Position, "daysLeft" | "inSheet" | "fit">;

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A PhD-level posting by its title: studentships and doctoral posts, not postdocs. */
const phdLevel = (title: string) =>
  /\b(phd|ph\.d|doctoral|doctorate|studentship|dphil|promotion|doktorand)/i.test(title) &&
  !/\bpost-?doc/i.test(title);

/** Keeps postings at the query's school, for boards that can't filter by it. */
const narrow = (q: PositionQuery, found: RawPosition[]) =>
  found.filter((p) => !q.university || sameSchool(p.university, q.university));

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/**
 * jobs.ac.uk prints "04 Nov" without a year. A closing date is the next such day from today; a
 * placed date the last one up to today.
 */
export function shortDate(s: string, today: Date, ahead: boolean): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})/.exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf((m[2] ?? "").toLowerCase());
  if (month < 0) return null;
  const day = Number(m[1]);
  const year = today.getUTCFullYear();
  const candidate = Date.UTC(year, month, day);
  const todayUtc = Date.UTC(year, today.getUTCMonth(), today.getUTCDate());
  const y = ahead
    ? candidate < todayUtc
      ? year + 1
      : year
    : candidate > todayUtc
      ? year - 1
      : year;
  return `${y}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The `j-search-result__result` rows on a jobs.ac.uk search page; studentships only. */
export function parseJobsAcUk(html: string, today = new Date()): RawPosition[] {
  const out: RawPosition[] = [];
  for (const [, id, row] of html.matchAll(
    /<div class="j-search-result__result[^"]*" data-advert-id="(\d+)">([\s\S]*?)<div class="j-search-result__save-job"/g,
  )) {
    if (!id || !row) continue;
    const link = /<a href="(\/job\/[^"]+)">\s*([\s\S]*?)\s*<\/a>/.exec(row);
    const title = strip(link?.[2] ?? "");
    if (!link?.[1] || !phdLevel(title)) continue;
    const field = (cls: string) =>
      strip(
        new RegExp(`<div class="j-search-result__${cls}">([\\s\\S]*?)</div>`).exec(row)?.[1] ?? "",
      );
    const funding = field("info").replace(/^Salary:\s*/i, "");
    const closes = /Closes<\/span>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/.exec(row)?.[1] ?? "";
    const placed = /Date Placed:\s*<\/strong>\s*([^<]+)/.exec(row)?.[1] ?? "";
    out.push({
      source: "jobs.ac.uk",
      id,
      title,
      professor: "",
      university: field("employer"),
      country: "United Kingdom",
      funding,
      deadline: shortDate(closes, today, true),
      posted: shortDate(placed, today, false),
      url: `https://www.jobs.ac.uk${link[1]}`,
      abstract: field("department"),
    });
  }
  return out;
}

export async function jobsAcUkPositions(q: PositionQuery): Promise<RawPosition[]> {
  const url = new URL("https://www.jobs.ac.uk/search/");
  url.searchParams.set("keywords", `${q.terms.join(" ")} PhD`);
  url.searchParams.set("pageSize", "25");
  return narrow(q, parseJobsAcUk(await getText(url.toString())));
}

/** INSPIRE's jobs API: open PhD positions in physics, with the contact the posting names. */
export function parseInspire(body: unknown): RawPosition[] {
  return asArray(asRecord(asRecord(body).hits).hits).flatMap((hit) => {
    const h = asRecord(hit);
    const m = asRecord(h.metadata);
    const id = text(m.control_number);
    const title = text(m.position);
    if (!id || !title) return [];
    const institution = asArray(m.institutions).map((i) => text(asRecord(i).value))[0] ?? "";
    const contact = asArray(m.contact_details).map((c) => text(asRecord(c).name))[0] ?? "";
    // INSPIRE writes names "Surname, Given"; the sheet keys on "Given Surname".
    const professor = contact.includes(",")
      ? contact
          .split(",")
          .map((s) => s.trim())
          .toReversed()
          .join(" ")
      : contact;
    return [
      {
        source: "INSPIRE" as const,
        id,
        title,
        professor,
        university: institution,
        country: asArray(m.regions).map(text).join(", "),
        funding: "",
        deadline: text(m.deadline_date) || null,
        posted: text(h.created).slice(0, 10) || null,
        url: `https://inspirehep.net/jobs/${id}`,
        abstract: strip(text(m.description)).slice(0, 600),
      },
    ];
  });
}

export async function inspirePositions(q: PositionQuery): Promise<RawPosition[]> {
  const url = new URL("https://inspirehep.net/api/jobs");
  url.searchParams.set("q", q.terms.join(" "));
  url.searchParams.set("rank", "PHD");
  url.searchParams.set("status", "open");
  url.searchParams.set("size", "25");
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`inspirehep.net answered ${res.status}`);
  return narrow(q, parseInspire(await res.json()));
}

/**
 * The boards that cover a hunt: jobs.ac.uk for the UK or no place named, INSPIRE when the fields
 * are physics. Elsewhere none: US programs admit through applications, not adverts.
 */
export function positionSourcesFor(places: string[], fields: string[]): PositionSource[] {
  const where = places.join(" ").toLowerCase();
  const picked = new Set<PositionSource>();
  if (!where.trim() || UK_PLACES.test(where)) picked.add("jobs.ac.uk");
  if (/\b(physics|astro|particle|hep|cosmolog|nuclear)/i.test(fields.join(" ")))
    picked.add("INSPIRE");
  return [...picked];
}

/** Whole days from today to the deadline; negative once closed. */
export function daysLeft(deadline: string | null, today = new Date()) {
  if (!deadline) return null;
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return null;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((end.getTime() - t) / 864e5);
}
