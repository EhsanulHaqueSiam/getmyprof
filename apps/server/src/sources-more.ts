// More free sources: DFG (Germany, GEPRIS) and NSERC (Canada) awards, CSRankings' faculty
// lists, and OpenAlex by topic (who works on it at a school; topics next to a field). The big
// public files (CSRankings, NSERC) are kept under GRADCODE_HOME/cache for a month.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseCsv } from "./adapters.ts";
import { homeDir } from "./db.ts";
import { personKey } from "./records.ts";
import {
  type AwardQuery,
  type RawAward,
  asArray,
  asRecord,
  getJson,
  sameSchool,
  text,
} from "./sources.ts";

const MONTH = 30 * 864e5;

/** A big public file, downloaded at most once a month into GRADCODE_HOME/cache. */
async function cached(name: string, url: string, encoding: BufferEncoding = "utf8") {
  const file = NodePath.join(homeDir(), "cache", name);
  try {
    if (Date.now() - NodeFS.statSync(file).mtimeMs < MONTH)
      return NodeFS.readFileSync(file, encoding);
  } catch {
    // Not there yet.
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, bytes);
  return bytes.toString(encoding);
}

/** "Professor Dr.-Ing. Ada Lovelace" as "Ada Lovelace". */
const bareName = (s: string) =>
  s.replace(/\b(Professorin|Professor|Prof\.|Dr\.-Ing\.|Dr\.|PD|Dipl\.-\w+\.?)\s*/g, "").trim();

const matches = (haystack: string, terms: string[]) => {
  const h = haystack.toLowerCase();
  return terms.length === 0 || terms.some((t) => h.includes(t.toLowerCase()));
};

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

// The latest fiscal year NSERC has published; the year before if that one is missing.
const NSERC_YEARS = ["2024", "2023"];
let nserc: string[][] | null = null;

/**
 * NSERC awards from its open data (the latest fiscal year's file, about 56 MB, cached). Amounts
 * are per year; a Discovery Grant runs five years from its competition year, so the end date
 * is that, to March 31.
 */
export async function nsercAwards(q: AwardQuery): Promise<RawAward[]> {
  if (!nserc) {
    for (const fy of NSERC_YEARS) {
      try {
        nserc = parseCsv(
          await cached(
            `nserc-FY${fy}.csv`,
            `https://www.nserc-crsng.gc.ca/opendata/NSERC_FY${fy}_Expenditures.csv`,
            "latin1",
          ),
        );
        break;
      } catch {
        // Try the year before.
      }
    }
    if (!nserc) throw new Error("NSERC's award data is unreachable");
  }
  const [head = [], ...rows] = nserc;
  const col = (name: string) => head.findIndex((h) => h.replace(/^\W+/, "").startsWith(name));
  const at = {
    id: col("ApplicationID"),
    name: col("Name"),
    school: col("Institution"),
    year: col("CompetitionYear"),
    amount: col("AwardAmount"),
    program: col("ProgramNameEN"),
    title: col("ApplicationTitle"),
    keywords: col("Keywords"),
    summary: col("ApplicationSummary"),
  };
  const after = q.activeAfter?.slice(0, 10);
  return rows
    .flatMap((r) => {
      const get = (i: number) => r[i] ?? "";
      // "Smol, John JP" as "John JP Smol".
      const pi = get(at.name).split(",").toReversed().join(" ").trim();
      const competed = Number(get(at.year));
      const ends = competed ? `${competed + 5}-03-31` : null;
      if (after && ends && ends < after) return [];
      if (q.university && !sameSchool(get(at.school), q.university)) return [];
      if (q.pi && personKey(pi) !== personKey(q.pi)) return [];
      if (!matches(`${get(at.title)} ${get(at.keywords)} ${get(at.summary)}`, q.terms)) return [];
      return [
        {
          source: "NSERC" as const,
          id: get(at.id),
          title: get(at.title),
          pi,
          university: get(at.school),
          amount: Number(get(at.amount)) || null,
          currency: "CAD",
          url: "https://www.nserc-crsng.gc.ca/ase-oro/index_eng.asp",
          starts: competed ? `${competed}-04-01` : null,
          ends,
          abstract: `${get(at.program)}. Amount is per year. ${get(at.summary)}`.slice(0, 600),
        },
      ];
    })
    .slice(0, 50);
}

export type Faculty = { name: string; homepage: string; scholar: string };
let rankings: string[][] | null = null;

/** The faculty CSRankings lists at a school, with their homepage and Google Scholar page. */
export async function csrankingsFaculty(university: string): Promise<Faculty[]> {
  rankings ??= parseCsv(
    await cached(
      "csrankings.csv",
      "https://raw.githubusercontent.com/emeryberger/CSrankings/gh-pages/csrankings.csv",
    ),
  );
  return rankings
    .slice(1)
    .filter((r) => sameSchool(r[1] ?? "", university))
    .map(([name = "", , homepage = "", scholar = ""]) => ({
      // CSRankings marks namesakes with a number: "Wei Wang 0001".
      name: name.replace(/\s+\d{4}$/, ""),
      homepage,
      scholar:
        scholar && scholar !== "NOSCHOLARPAGE"
          ? `https://scholar.google.com/citations?user=${scholar}`
          : "",
    }));
}

const firstId = async (path: string) =>
  text(asRecord(asArray(asRecord(await getJson(`https://api.openalex.org/${path}`)).results)[0]).id)
    .split("/")
    .at(-1) ?? "";

export type TopicAuthor = {
  name: string;
  works: number;
  citations: number;
  topics: string[];
  link: string;
};

/** Who at a school works on a topic, by OpenAlex: most published first. */
export async function openAlexByTopic(topic: string, university: string): Promise<TopicAuthor[]> {
  const [inst, top] = await Promise.all([
    firstId(`institutions?search=${encodeURIComponent(university)}&per-page=1`),
    firstId(`topics?search=${encodeURIComponent(topic)}&per-page=1`),
  ]);
  if (!inst || !top) return [];
  const body = asRecord(
    await getJson(
      `https://api.openalex.org/authors?filter=last_known_institutions.id:${inst},topics.id:${top}&sort=works_count:desc&per-page=25`,
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
