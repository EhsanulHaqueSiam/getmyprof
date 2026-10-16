// More free sources: DFG (Germany, GEPRIS) and OpenAlex (every other funder) awards,
// CSRankings' faculty lists, OpenAlex by topic (who works on it at a school; topics next to a
// field) and emails printed on papers (Europe PMC). CSRankings' files are kept under
// GETMYPROF_HOME/cache for a month (sources-files.ts).
import { parseCsv } from "./adapters.ts";
import { cached } from "./sources-files.ts";
import { personKey } from "./records.ts";
import { sameSchoolName } from "@getmyprof/contracts";
import {
  type AwardQuery,
  type RawAward,
  asArray,
  asRecord,
  getJson,
  narrow,
  sameSchool,
  text,
} from "./sources.ts";

/** "Professor Dr.-Ing. Ada Lovelace" as "Ada Lovelace". */
const bareName = (s: string) =>
  s.replace(/\b(Professorin|Professor|Prof\.|Dr\.-Ing\.|Dr\.|PD|Dipl\.-\w+\.?)\s*/g, "").trim();

/** DFG projects from GEPRIS by topic, at a university or for a PI. DFG publishes no amounts. */
export async function dfgAwards(q: AwardQuery): Promise<RawAward[]> {
  const query = [...q.terms, q.pi ?? ""].filter(Boolean).join(" ") || "*";
  const body = asRecord(
    await getJson("https://gepris.dfg.de/backend/project/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query_string: query, size: "50" }),
    }),
  );
  const after = q.activeAfter?.slice(0, 4);
  return asArray(asRecord(body.hits).hits)
    .map(asRecord)
    .flatMap((h) => {
      const people = asArray(h.bt_pers).map(asRecord);
      // PAN is the applicant, the PI.
      const lead = people.find((p) => text(p.BTR_KEY_GRUP) === "PAN") ?? people[0];
      const host = asRecord(asArray(h.bt_ins_json)[0]);
      const university = (text(host.ins_nameenglisch) || text(host.ins_namedeutsch))
        .split(/\r?\n/)[0]
        ?.trim();
      const begin = text(h.prj_beginn_jahr);
      const end = text(h.prj_ende_jahr);
      const pi = bareName(text(lead?.bt_partner_name_komplett));
      if (after && end && end < after) return [];
      if (q.university && !sameSchool(university ?? "", q.university)) return [];
      if (q.pi && personKey(pi) !== personKey(q.pi)) return [];
      const id = text(h.prj_id);
      return [
        {
          source: "DFG" as const,
          id,
          title: text(h.prj_titel_en) || text(h.prj_titel),
          pi,
          university: university ?? "",
          amount: null,
          currency: "EUR",
          url: `https://gepris.dfg.de/gepris/projekt/${id}`,
          starts: begin ? `${begin}-01-01` : null,
          ends: end ? `${end}-12-31` : null,
          abstract: (text(h.prj_abstract_en) || text(h.prj_abstract)).slice(0, 600),
        },
      ];
    });
}

export type Faculty = {
  name: string;
  homepage: string;
  scholar: string;
  /** Where they published in the last five years, most first: "acl 5, emnlp 3" means NLP. */
  venues: string;
};
let rankings: string[][] | null = null;
let venuesByName: Map<string, Map<string, number>> | null = null;

/** Each CSRankings name's papers per venue in the last five years, from its per-paper counts. */
async function recentVenues() {
  if (venuesByName) return venuesByName;
  const since = new Date().getFullYear() - 5;
  const out = new Map<string, Map<string, number>>();
  const rows = parseCsv(
    await cached(
      "csrankings-authors.csv",
      "https://raw.githubusercontent.com/emeryberger/CSrankings/gh-pages/generated-author-info.csv",
    ),
  );
  for (const [name = "", , venue = "", count = "0", , year = "0"] of rows.slice(1)) {
    if (Number(year) < since) continue;
    const at = out.get(name) ?? new Map<string, number>();
    at.set(venue, (at.get(venue) ?? 0) + Number(count));
    out.set(name, at);
  }
  return (venuesByName = out);
}

/**
 * The faculty CSRankings lists at a school, with their homepage, Google Scholar page and the
 * venues they published in lately, so a sweep can spot everyone in a field at a glance.
 */
export async function csrankingsFaculty(university: string): Promise<Faculty[]> {
  rankings ??= parseCsv(
    await cached(
      "csrankings.csv",
      "https://raw.githubusercontent.com/emeryberger/CSrankings/gh-pages/csrankings.csv",
    ),
  );
  const venues = await recentVenues().catch(() => new Map<string, Map<string, number>>());
  const rows = rankings.slice(1);
  // The very school first: "University of Illinois Chicago" alone, not UIUC and UChicago too.
  const exact = rows.filter((r) => sameSchoolName(r[1] ?? "", university));
  return (exact.length ? exact : rows.filter((r) => sameSchool(r[1] ?? "", university))).map(
    ([name = "", , homepage = "", scholar = ""]) => ({
      // CSRankings marks namesakes with a number: "Wei Wang 0001".
      name: name.replace(/\s+\d{4}$/, ""),
      homepage,
      scholar:
        scholar && scholar !== "NOSCHOLARPAGE"
          ? `https://scholar.google.com/citations?user=${scholar}`
          : "",
      venues: [...(venues.get(name) ?? [])]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([v, n]) => `${v} ${Math.round(n)}`)
        .join(", "),
    }),
  );
}

const openAlexResults = async (path: string) =>
  asArray(asRecord(await getJson(`https://api.openalex.org/${path}`)).results).map(asRecord);
const idOf = (r: Record<string, unknown> | undefined) => text(r?.id).split("/").at(-1) ?? "";

export type TopicAuthor = {
  name: string;
  works: number;
  citations: number;
  topics: string[];
  link: string;
};

/** A school's OpenAlex id: the very school, not the first hit ("University of Utah", not Utah State). */
async function institutionId(university: string) {
  const insts = await openAlexResults(
    `institutions?search=${encodeURIComponent(university)}&per-page=5`,
  );
  return idOf(insts.find((i) => sameSchoolName(text(i.display_name), university)) ?? insts[0]);
}

/** Who at a school works on a topic, by OpenAlex: most published first. */
export async function openAlexByTopic(topic: string, university: string): Promise<TopicAuthor[]> {
  const [inst, tops] = await Promise.all([
    institutionId(university),
    openAlexResults(`topics?search=${encodeURIComponent(topic)}&per-page=3`),
  ]);
  // Any of the three closest topics, since one topic name rarely covers a field.
  const top = tops.map(idOf).filter(Boolean).join("|");
  if (!inst || !top) return [];
  const body = asRecord(
    await getJson(
      `https://api.openalex.org/authors?filter=last_known_institutions.id:${inst},topics.id:${top}&sort=works_count:desc&per-page=50`,
    ),
  );
  return asArray(body.results)
    .map(asRecord)
    .map((a) => ({
      name: text(a.display_name),
      works: Number(a.works_count) || 0,
      citations: Number(a.cited_by_count) || 0,
      topics: asArray(a.topics)
        .slice(0, 3)
        .map((t) => text(asRecord(t).display_name)),
      link: text(a.id),
    }));
}

/** Topics next to the applicant's fields, by OpenAlex: its closest topics and their subfields. */
export async function adjacentTopics(fields: string[]): Promise<string[]> {
  const mine = fields.map((f) => f.toLowerCase());
  const found = await Promise.all(
    fields.slice(0, 5).map(async (f) =>
      asArray(
        asRecord(
          await getJson(
            `https://api.openalex.org/topics?search=${encodeURIComponent(f)}&per-page=6`,
          ),
        ).results,
      )
        .map(asRecord)
        .flatMap((t) => [text(t.display_name), text(asRecord(t.subfield).display_name)]),
    ),
  );
  const seen = new Set<string>();
  return found
    .flat()
    .filter((t) => {
      const k = t.toLowerCase();
      if (!t || seen.has(k) || mine.some((m) => k.includes(m) || m.includes(k))) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 10);
}

// NSF and NIH: their direct sources carry emails and co-PIs, so OpenAlex leaves them out.
const DIRECT_FUNDERS = ["F4320306076", "F4320332161"];

/** An OpenAlex awards page as awards. SNSF's names arrive as "Rinaldi, Fabio"; this rights them. */
export const parseOpenAlexAwards = (body: unknown): RawAward[] =>
  asArray(asRecord(body).results)
    .map(asRecord)
    .map((a) => {
      const lead = asRecord(a.lead_investigator);
      const full = `${text(lead.given_name)} ${text(lead.family_name)}`.trim();
      const [last = "", first = ""] = full.split(/,\s*/);
      return {
        source: "OpenAlex" as const,
        funder: text(asRecord(a.funder).display_name),
        id: idOf(a),
        title: text(a.display_name),
        pi: full.includes(",") ? `${first} ${last}` : full,
        university:
          text(asRecord(asArray(a.institution_awarded)[0]).display_name) ||
          text(asRecord(lead.affiliation).name),
        amount: a.amount == null ? null : Number(a.amount),
        currency: text(a.currency) || "USD",
        url: text(a.landing_page_url) || text(a.id),
        starts: text(a.start_date) || null,
        ends: text(a.end_date) || null,
        abstract: text(a.description).slice(0, 600),
      };
    });

/**
 * Awards from OpenAlex's index, for the funders no direct source reads: JSPS (Japan), SNSF, ERC,
 * CIHR and FRQ (Canada), the US DoD, Sweden, Norway, Hong Kong... At one school, else in the
 * hunt's countries. Its search reads titles and abstracts, not names, so a PI goes by family name.
 */
export async function openAlexAwards(q: AwardQuery): Promise<RawAward[]> {
  const inst = q.university ? await institutionId(q.university) : "";
  if (q.university && !inst) return [];
  // The name filters match lowercase only.
  const last =
    (q.pi ?? "")
      .split(/\s+/)
      .at(-1)
      ?.replace(/[^\p{L}'-]/gu, "")
      .toLowerCase() ?? "";
  const base = [
    inst
      ? `institution_awarded.id:${inst}`
      : q.countries?.length
        ? `institution_awarded.country_code:${q.countries.join("|")}`
        : "",
    q.activeAfter ? `end_year:>${Number(q.activeAfter.slice(0, 4)) - 1}` : "",
    ...DIRECT_FUNDERS.map((f) => `funder.id:!${f}`),
  ];
  const search = q.terms.map((t) => `"${t.replaceAll('"', " ")}"`).join(" OR ");
  // A PI goes by family name; SNSF files that as the given name ("Rinaldi,"), so ask both.
  const pages = await Promise.all(
    (last ? [`family_name:${last}`, `given_name:${last}`] : [""]).map((who) => {
      const filter = [...base, who && `lead_investigator.${who}`].filter(Boolean).join(",");
      return getJson(
        `https://api.openalex.org/awards?${new URLSearchParams({ filter, ...(search ? { search } : {}), "per-page": "50" })}`,
      );
    }),
  );
  const awards = new Map(pages.flatMap(parseOpenAlexAwards).map((a) => [a.id, a]));
  return narrow(q, [...awards.values()]);
}

export type PaperEmail = { email: string; paper: string; year: string };

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * One person's emails on their affiliation lines at a school, newest paper first, once each. A
 * line can carry a co-author's address, so an address counts only if it holds their own name.
 */
export function emailsIn(body: unknown, name: string, university: string): PaperEmail[] {
  const who = personKey(name);
  const seen = new Map<string, PaperEmail>();
  for (const r of asArray(asRecord(asRecord(body).resultList).result).map(asRecord)) {
    for (const a of asArray(asRecord(r.authorList).author).map(asRecord)) {
      if (personKey(`${text(a.firstName)} ${text(a.lastName)}`) !== who) continue;
      const own = [letters(text(a.firstName)), letters(text(a.lastName))].filter(
        (w) => w.length > 2,
      );
      const lines = asArray(asRecord(a.authorAffiliationDetailsList).authorAffiliation)
        .map((x) => text(asRecord(x).affiliation))
        .filter((x) => sameSchool(x, university));
      for (const found of lines.join(" ").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
        const email = found.toLowerCase();
        const local = letters(email.split("@")[0] ?? "");
        if (own.some((w) => local.includes(w)) && !seen.has(email))
          seen.set(email, {
            email,
            paper: `https://europepmc.org/article/${text(r.source)}/${text(r.id)}`,
            year: text(r.pubYear),
          });
      }
    }
  }
  return [...seen.values()];
}

/**
 * Emails a professor printed on their papers (Europe PMC, so mostly biomedical and clinical
 * faculty), each with the paper it is on. Free.
 */
export async function paperEmails(name: string, university: string): Promise<PaperEmail[]> {
  // "Guilherme Del Fiol" as "Del Fiol", "Kevin J. Lybarger" as "Lybarger".
  const surname = name
    .split(/\s+/)
    .slice(1)
    .filter((w) => !/^\p{L}\.?$/u.test(w))
    .join(" ");
  if (!surname) return [];
  const query = `AUTH:"${surname.replaceAll('"', " ")}" AND AFF:"${university.replaceAll('"', " ")}"`;
  const body = await getJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${new URLSearchParams({ query, resultType: "core", format: "json", pageSize: "25", sort: "P_PDATE_D desc" })}`,
  );
  return emailsIn(body, name, university);
}
