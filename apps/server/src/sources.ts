// Data sources the agent and the Funding view use: free public APIs (NSF, NIH RePORTER, UKRI,
// CORDIS, ARC, OpenAlex). Paid lookups go through treg.ts.
import type { Award } from "@getmyprof/contracts";

const TIMEOUT_MS = 20_000;

export async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown) => (v == null ? "" : String(v));

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

export type AwardQuery = {
  terms: string[];
  university?: string;
  pi?: string;
  activeAfter?: string;
};
export type RawAward = Omit<Award, "monthsAfterIntake" | "inSheet" | "fit">;

const schoolWords = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(
      (w) =>
        w.length > 3 &&
        !["university", "college", "state", "institute", "school", "campus", "the"].includes(w),
    );

/** "UNIVERSITY OF READING" and "University of Reading" are the same school. */
export const sameSchool = (a: string, b: string) => {
  const wa = schoolWords(a);
  return schoolWords(b).some((w) => wa.includes(w));
};

/** Keeps awards that match the query's school, PI and end date, for APIs that can't filter. */
const narrow = (q: AwardQuery, awards: RawAward[]) =>
  awards.filter(
    (a) =>
      (!q.university || sameSchool(a.university, q.university)) &&
      (!q.pi || a.pi.toLowerCase().includes(q.pi.toLowerCase().split(/\s+/).at(-1) ?? "")) &&
      (!q.activeAfter || !a.ends || a.ends >= q.activeAfter),
  );

const isoDay = (ms: unknown) =>
  typeof ms === "number" ? new Date(ms).toISOString().slice(0, 10) : null;

/** UKRI Gateway to Research: UK research council grants, with the PI. Amounts in GBP. */
export async function ukriAwards(q: AwardQuery): Promise<RawAward[]> {
  const out = new Map<string, RawAward>();
  const quote = (t: string) => `"${t.replaceAll('"', " ")}"`;
  // One quoted phrase per term (an unquoted term matches almost anything), latest end date first
  // so the grants that outlast an intake come back first.
  for (const term of q.terms.length ? q.terms : [""]) {
    const phrase = [term, q.university ?? "", q.pi ?? ""].filter(Boolean).map(quote).join(" ");
    const body = asRecord(
      await getJson(
        `https://gtr.ukri.org/api/search/project?${new URLSearchParams({ term: phrase, page: "1", fetchSize: "50", selectedSortableField: "pro.ed", selectedSortOrder: "DESC" })}`,
        { headers: { accept: "application/json" } },
      ),
    );
    for (const r of asArray(asRecord(body.facetedSearchResultBean).results).map(asRecord)) {
      const c = asRecord(r.projectComposition);
      const p = asRecord(c.project);
      const fund = asRecord(p.fund);
      if (text(p.grantCategory) === "Studentship") continue;
      const pi = asArray(c.personRoles)
        .map(asRecord)
        .find((x) =>
          asArray(x.roles)
            .map(asRecord)
            .some((y) => text(y.name) === "PRINCIPAL_INVESTIGATOR"),
        );
      const ref = text(p.grantReference);
      out.set(ref, {
        source: "UKRI",
        id: ref,
        title: text(p.title),
        pi: pi ? `${text(pi.firstName)} ${text(pi.surname)}`.trim() : "",
        university: text(asRecord(c.leadResearchOrganisation).name),
        amount: fund.valuePounds == null ? null : Number(fund.valuePounds),
        currency: "GBP",
        url: `https://gtr.ukri.org/projects?ref=${encodeURIComponent(ref)}`,
        starts: isoDay(fund.start),
        ends: isoDay(fund.end),
        abstract: text(p.abstractText).slice(0, 600),
      });
    }
  }
  return narrow(q, [...out.values()]);
}

/** CORDIS: EU Horizon and ERC projects. It names the host organisation, not the PI. Amounts in EUR. */
export async function cordisAwards(q: AwardQuery): Promise<RawAward[]> {
  const phrases = [...q.terms, q.university ?? ""]
    .filter(Boolean)
    .map((t) => `'${t.replaceAll("'", " ")}'`);
  const query = ["contenttype='project'", ...phrases].join(" AND ");
  const body = asRecord(
    await getJson(
      `https://cordis.europa.eu/search/en?${new URLSearchParams({ q: query, format: "json", p: "1", num: "50" })}`,
    ),
  );
  const hits = asRecord(body.hits).hit;
  return narrow(
    q,
    (Array.isArray(hits) ? hits : hits ? [hits] : []).map(asRecord).map((h) => {
      const p = asRecord(h.project);
      const orgs = asRecord(asRecord(p.relations).associations).organization;
      const host = (Array.isArray(orgs) ? orgs : [orgs])
        .map(asRecord)
        .find((o) => text(asRecord(o["@attributes"]).type) === "coordinator");
      const id = text(p.id);
      return {
        source: "CORDIS" as const,
        id,
        title: text(p.title),
        pi: "",
        university: text(host?.legalName),
        amount: p.ecMaxContribution == null ? null : Number(p.ecMaxContribution),
        currency: "EUR",
        url: `https://cordis.europa.eu/project/id/${id}`,
        starts: text(p.startDate) || null,
        ends: text(p.endDate) || null,
        abstract: text(p.teaser).slice(0, 600),
      };
    }),
  );
}

/** ARC: Australian Research Council grants, with the lead investigator. Amounts in AUD. */
export async function arcAwards(q: AwardQuery): Promise<RawAward[]> {
  const filter = [...q.terms, q.pi ?? ""]
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(" ");
  const body = asRecord(
    await getJson(
      // ARC can't sort or filter by status; a topic rarely passes 100 grants, so read them all.
      `https://dataportal.arc.gov.au/NCGP/API/grants?${new URLSearchParams({ filter, "page[size]": "100" })}`,
    ),
  );
  return narrow(
    q,
    asArray(body.data)
      .map(asRecord)
      .map((g) => {
        const a = asRecord(g.attributes);
        const id = text(a.code);
        const summary = text(a["grant-summary"]);
        return {
          source: "ARC" as const,
          id,
          title: summary.split(". ")[0] ?? summary,
          pi: text(a["lead-investigator"]).replace(
            /^(Prof|Dr|A\/Prof|Associate Professor)\s+/i,
            "",
          ),
          university: text(a["current-admin-organisation"]),
          amount: a["current-funding-amount"] == null ? null : Number(a["current-funding-amount"]),
          currency: "AUD",
          url: `https://dataportal.arc.gov.au/NCGP/Web/Grant/Grant/${id}`,
          starts: a["funding-commencement-year"]
            ? `${text(a["funding-commencement-year"])}-01-01`
            : null,
          ends: text(a["anticipated-end-date"]) || null,
          abstract: summary.slice(0, 600),
        };
      }),
  );
}

/** The databases that cover a hunt's places. Places that name none default to the US pair. */
export function sourcesFor(places: string[]): Award["source"][] {
  const where = places.join(" ").toLowerCase();
  const picked = new Set<Award["source"]>();
  if (!where.trim() || /\b(usa|us|united states|america)\b/.test(where)) {
    picked.add("NSF");
    picked.add("NIH");
  }
  if (/\b(uk|united kingdom|england|scotland|wales|britain)\b/.test(where)) picked.add("UKRI");
  if (
    /\b(eu|europe|germany|france|netherlands|sweden|denmark|finland|switzerland|spain|italy|ireland|austria|belgium|norway|portugal|poland)\b/.test(
      where,
    )
  )
    picked.add("CORDIS");
  if (/\baustralia\b/.test(where)) picked.add("ARC");
  if (/\bgermany\b/.test(where)) picked.add("DFG");
  if (/\bcanada\b/.test(where)) picked.add("NSERC");
  // Places none of these cover (India...) get none: the agent searches the web for their
  // funders instead of quietly reading US awards.
  return picked.size || where.trim() ? [...picked] : ["NSF", "NIH"];
}

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
        amount: a.estimatedTotalAmt == null ? null : Number(a.estimatedTotalAmt),
        currency: "USD",
        url: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${id}`,
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
          amount: r.award_amount == null ? null : Number(r.award_amount),
          currency: "USD",
          url: `https://reporter.nih.gov/project-details/${id}`,
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
