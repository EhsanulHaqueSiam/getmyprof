// Advertised PhD positions from free boards: jobs.ac.uk (HTML search; UK studentships), INSPIRE
// (JSON API; physics, worldwide), DAAD's PhDGermany feed (RSS; Germany), AcademicTransfer (the
// job data its own page embeds; Netherlands) and MUR's doctorate calls (HTML; Italy). Each parser
// is pure and tested on saved markup; the fetchers only add the request. Euraxess renders its
// results in the browser behind an antibot form (a fetch sees the newest ten posts whatever the
// query), and FindAPhD and AcademicPositions sit behind a bot wall, so the agent finds those
// postings with WebSearch.
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

/** Salary or stipend, from the posting's words: a contract is a job, a studentship a scholarship. */
export function payKind(words: string): Position["kind"] {
  if (
    /\b(tv-?l|e ?13|salar|contract|employ|anstellung|gehalt|chf|bruto|gross|per month|a month|monthly)/i.test(
      words,
    )
  )
    return "employment";
  if (/\b(stipend|scholarship|studentship|borsa|bursary|fellowship|tax-free)/i.test(words))
    return "scholarship";
  return "unknown";
}

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
      kind: payKind(funding),
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
        kind: "unknown" as const,
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

/** Each <item> of an RSS feed as its tags, CDATA unwrapped. */
const rssItems = (xml: string) =>
  [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) =>
    Object.fromEntries(
      [...(item ?? "").matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(([, tag, body]) => [
        tag,
        (body ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim(),
      ]),
    ),
  );

/** DAAD's "09. Oct 2026" to ISO. */
const daadDate = (s: string) => {
  const m = /(\d{1,2})\.\s*([A-Za-z]{3})\w*\s+(\d{4})/.exec(s);
  const month = m ? MONTHS.indexOf(m[2]!.toLowerCase()) : -1;
  return m && month >= 0
    ? `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`
    : null;
};

/** "Prof. Nikolay Kornienko" from "in the group of Prof. Nikolay Kornienko (electro...". */
const namedProfessor = (words: string) =>
  /\b(?:Prof\.?(?:essor)?|Dr\.?|PD Dr\.?)\s+(?:Dr\.?\s+)?([A-ZÀ-Ý][\wÀ-ÿ'-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'-]+){1,2})/.exec(
    words,
  )?.[1] ?? "";

/** DAAD's PhDGermany feed: the funding line and supervisor are in the description's own words. */
export function parseDaad(xml: string): RawPosition[] {
  return rssItems(xml).flatMap((i) => {
    const id = i.guid ?? "";
    const title = i.title ?? "";
    if (!id || !title) return [];
    const body = strip(i.description ?? "");
    // "TV-L E13, 50%" or "1,500 € a month", in the posting's words, up to the closing bracket
    // or sentence.
    const pay =
      /\b(?:TV-?L\s*E ?13|E ?13|[\d.,]+\s*(?:€|EUR|euros?))[^.;)]*/i.exec(body)?.[0] ?? "";
    const funding =
      pay.trim() ||
      (/\b(DFG|BMBF|ERC|Marie|MSCA|DAAD|stipend|scholarship)\b/i.exec(body)?.[0] ?? "");
    // A university over the institute named before it: "Institute of X, University of Bonn".
    const university =
      /\b((?:University|Universität|TU|RWTH|Hochschule|Max Planck|Fraunhofer|Helmholtz)[^.,;()]{0,60})/
        .exec(body)?.[1]
        ?.trim() ??
      /\b((?:Institute|Institut)[^.,;()]{0,60})/.exec(body)?.[1]?.trim() ??
      (i.company || i.location || "");
    return [
      {
        source: "DAAD" as const,
        id,
        title,
        professor: namedProfessor(body),
        university,
        country: "Germany",
        funding,
        kind: payKind(funding || body),
        deadline: daadDate(i.applicationDeadline ?? ""),
        posted: daadDate(i.pubDate ?? ""),
        url: i.link ?? "",
        abstract: body.slice(0, 600),
      },
    ];
  });
}

/** A feed has no search: keep posts naming any word of a term ("machine" or "learning"). */
const mentions = (terms: string[], p: RawPosition) => {
  const words = terms.flatMap((t) => t.toLowerCase().split(/\W+/)).filter((w) => w.length > 3);
  const body = `${p.title} ${p.abstract}`.toLowerCase();
  return !words.length || words.some((w) => body.includes(w));
};

export async function daadPositions(q: PositionQuery): Promise<RawPosition[]> {
  const all = parseDaad(await getText("https://api.daad.de/api/feeds/rss/en/phd.xml"));
  return narrow(
    q,
    all.filter((p) => mentions(q.terms, p)),
  );
}

/**
 * Nuxt's devalue payload: one flat array where every object value is the index of another entry.
 * Resolves an index into plain data; reactive wrappers ("Ref", "Reactive"...) unwrap to their target.
 */
function devalue(arr: unknown[], i: unknown, depth = 0): unknown {
  if (typeof i !== "number" || depth > 40) return i;
  const v = arr[i];
  if (Array.isArray(v)) {
    if (typeof v[0] === "string" && /^(Shallow)?(Reactive|Ref)$|^EmptyRef$|^Set$|^Map$/.test(v[0]))
      return typeof v[1] === "number" ? devalue(arr, v[1], depth + 1) : null;
    return v.map((x) => devalue(arr, x, depth + 1));
  }
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, devalue(arr, x, depth + 1)]));
  return v;
}

/**
 * AcademicTransfer's job search page: the vacancies its own store loaded, embedded as Nuxt data.
 * Unofficial, so the shape is one site deploy away from changing; the test on a saved page says when.
 */
export function parseAcademicTransfer(html: string): RawPosition[] {
  const payload = /id="__NUXT_DATA__">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!payload) return [];
  const arr = asArray(JSON.parse(payload));
  const root = asRecord(devalue(arr, 0));
  const store = asRecord(asRecord(asRecord(asRecord(root.pinia)["vacancies-store"]).data));
  return asArray(store.results)
    .map(asRecord)
    .flatMap((j) => {
      const id = text(j.external_id) || text(j.id);
      const title = text(j.title);
      if (!id || !title || !phdLevel(title)) return [];
      const min = text(j.min_salary);
      const max = text(j.max_salary);
      const funding = min ? `EUR ${min}${max && max !== min ? ` to ${max}` : ""} a month` : "";
      return [
        {
          source: "AcademicTransfer" as const,
          id,
          title,
          professor: "",
          university: text(j.organisation_name),
          country: "Netherlands",
          funding,
          kind: funding ? ("employment" as const) : ("unknown" as const),
          deadline: text(j.end_date).slice(0, 10) || null,
          posted: text(j.created_datetime).slice(0, 10) || null,
          url: text(j.absolute_url),
          abstract: strip(text(j.excerpt)).slice(0, 600),
        },
      ];
    });
}

export async function academicTransferPositions(q: PositionQuery): Promise<RawPosition[]> {
  const url = new URL("https://www.academictransfer.com/en/jobs/");
  url.searchParams.set("q", [...q.terms, "PhD"].join(" "));
  return narrow(q, parseAcademicTransfer(await getText(url.toString())));
}

/** MUR's "02/11/2026" to ISO. */
const murDate = (s: string) => {
  const m = /(\d\d)\/(\d\d)\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * MUR's doctorate calls (bandi.mur.gov.it): every open call, one per university programme,
 * with its closing date, seat count and the disciplinary sectors it names. Italy's season is May
 * to June for an autumn start, so outside it the list is short. All are scholarships (borse).
 */
export function parseMur(html: string): RawPosition[] {
  return [...html.matchAll(/<p>\s*<em class="aperto">([\s\S]*?)<\/p>/g)].flatMap(([, block]) => {
    const link =
      /href="\/doctorate\.php\/public\/fellowship\/id_fellow\/(\d+)">([\s\S]*?)<\/a>/.exec(
        block ?? "",
      );
    if (!link?.[1]) return [];
    const university = strip(/<strong>([\s\S]*?)<\/strong>/.exec(block ?? "")?.[1] ?? "");
    const sectors = [...(block ?? "").matchAll(/<strong>Settore ([\s\S]*?)<\/strong>/g)].map(
      ([, s]) => strip(s ?? ""),
    );
    const seats = /Numero posti:\s*(\d+)/.exec(block ?? "")?.[1];
    return [
      {
        source: "MUR" as const,
        id: link[1],
        title: strip(link[2] ?? ""),
        professor: "",
        university,
        country: "Italy",
        funding: `PhD scholarship (borsa)${seats ? `, ${seats} seats` : ""}`,
        kind: "scholarship" as const,
        deadline: murDate(block ?? ""),
        posted: null,
        url: `https://bandi.mur.gov.it/doctorate.php/public/fellowship/id_fellow/${link[1]}`,
        abstract: sectors.join("; ").slice(0, 600),
      },
    ];
  });
}

export async function murPositions(q: PositionQuery): Promise<RawPosition[]> {
  const url = new URL("https://bandi.mur.gov.it/doctorate.php/public/cercaFellowship");
  for (const [k, v] of Object.entries({
    jf_comp_status_id: "2-3",
    bb_type_code: "%",
    idarea: "%",
    idgsd24: "%",
    sad: "%",
    azione: "cerca",
  }))
    url.searchParams.set(k, v);
  const all = parseMur(await getText(url.toString()));
  // A bando names its sectors, not topics; keep calls naming a term, and the general ones (every
  // programme of a university) that name no sector.
  return narrow(
    q,
    all.filter((p) => !p.abstract || mentions(q.terms, p)),
  );
}

/**
 * The boards that cover a hunt: jobs.ac.uk for the UK or no place named, DAAD for Germany,
 * AcademicTransfer for the Netherlands, MUR for Italy, INSPIRE when the fields are physics.
 * Elsewhere none: US programs admit through applications, not adverts.
 */
export function positionSourcesFor(places: string[], fields: string[]): PositionSource[] {
  const where = places.join(" ").toLowerCase();
  const picked = new Set<PositionSource>();
  if (!where.trim() || UK_PLACES.test(where)) picked.add("jobs.ac.uk");
  if (/\bgermany\b/.test(where)) picked.add("DAAD");
  if (/\bnetherlands\b/.test(where)) picked.add("AcademicTransfer");
  if (/\bitaly\b/.test(where)) picked.add("MUR");
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
