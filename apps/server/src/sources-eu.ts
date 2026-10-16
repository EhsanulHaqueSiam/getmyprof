// European funders that name the PI, which CORDIS can't: NWO (Netherlands), research.fi
// (Finland), RAD-on (Poland) and ETIS (Estonia). Each is a free, anonymous JSON API. The parsers
// are pure and tested on saved responses under __samples__; the fetchers only add the request.
// France's ANR publishes files instead (sources-files.ts).
import {
  type AwardQuery,
  type RawAward,
  asArray,
  asRecord,
  getJson,
  sameSchool,
  text,
} from "./sources.ts";

/** Keeps awards at the query's school and still running after its date, for APIs that can't filter. */
const narrow = (q: AwardQuery, awards: RawAward[]) =>
  awards.filter(
    (a) =>
      (!q.university || sameSchool(a.university, q.university)) &&
      (!q.pi || a.pi.toLowerCase().includes(q.pi.toLowerCase().split(/\s+/).at(-1) ?? "")) &&
      (!q.activeAfter || !a.ends || a.ends >= q.activeAfter),
  );

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const day = (v: unknown) => text(v).slice(0, 10) || null;

/** NWO's project list: the project leader, their organisation (first segment of "a||b||c"), EUR. */
export function parseNwo(body: unknown): RawAward[] {
  return asArray(asRecord(body).projects)
    .map(asRecord)
    .map((p) => {
      const members = asArray(p.project_members).map(asRecord);
      const lead = members.find((m) => text(m.role) === "Project leader") ?? members[0];
      const org = text(lead?.organisation).split("||");
      const id = text(p.project_id);
      return {
        source: "NWO" as const,
        id,
        title: text(p.title),
        pi: [text(lead?.first_name), text(lead?.last_name)].filter(Boolean).join(" "),
        university: (org[1] ?? org[0] ?? "").trim(),
        amount: num(p.award_amount),
        currency: "EUR",
        url: `https://www.nwo.nl/en/projects/${id}`,
        starts: day(p.start_date),
        ends: day(p.end_date),
        abstract: (text(p.summary_en) || text(p.summary_nl)).slice(0, 600),
      };
    });
}

/** NWO: Dutch Research Council projects, with the project leader. Amounts in EUR. */
export async function nwoAwards(q: AwardQuery): Promise<RawAward[]> {
  const out = new Map<string, RawAward>();
  for (const term of q.terms.length ? q.terms : [""]) {
    const params = new URLSearchParams({ per_page: "50" });
    if (term) params.set("title", term);
    const body = await getJson(`https://nwopen-api.nwo.nl/NWOpen-API/api/Projects?${params}`);
    for (const a of parseNwo(body)) out.set(a.id, a);
  }
  return narrow(q, [...out.values()]);
}

/**
 * research.fi's funding index: the leading person of the funding group (Research Council of
 * Finland names them there; the contact person fields are blank) and their organisation, EUR.
 */
export function parseResearchFi(body: unknown): RawAward[] {
  return asArray(asRecord(asRecord(body).hits).hits)
    .map((h) => asRecord(asRecord(h)["_source"]))
    .map((s) => {
      const group = asArray(s.fundingGroupPerson).map(asRecord);
      const lead = group.find((g) => text(g.roleInFundingGroup) === "leader") ?? group[0];
      const name = (first: unknown, last: unknown) =>
        [text(first).trim(), text(last).trim()].filter(Boolean).join(" ");
      const id = text(s.projectId);
      const end = text(s.fundingEndDate).slice(0, 10);
      const endYear = text(s.fundingEndYear);
      return {
        source: "RESEARCHFI" as const,
        id,
        title: text(s.projectNameEn).trim() || text(s.projectNameFi).trim(),
        pi:
          name(lead?.fundingGroupPersonFirstNames, lead?.fundingGroupPersonLastName) ||
          name(s.fundingContactPersonFirstNames, s.fundingContactPersonLastName),
        university:
          text(lead?.consortiumOrganizationNameEn) || text(lead?.consortiumOrganizationNameFi),
        amount: num(s.amount_in_EUR),
        currency: "EUR",
        url: `https://research.fi/en/results/funding/${id}`,
        starts: text(s.fundingStartYear) ? `${text(s.fundingStartYear)}-01-01` : null,
        ends: end || (endYear ? `${endYear}-12-31` : null),
        abstract: (
          text(s.projectDescriptionEn).trim() || text(s.projectDescriptionFi).trim()
        ).slice(0, 600),
      };
    });
}

// The portal's own search backend, not a documented API: it is what research.fi itself queries.
const RESEARCHFI = "https://researchfi-api-production.2.rahtiapp.fi/portalapi/funding/_search";

/** research.fi: Finnish funding decisions (Research Council of Finland, Business Finland...). */
export async function researchFiAwards(q: AwardQuery): Promise<RawAward[]> {
  const out = new Map<string, RawAward>();
  for (const term of q.terms.length ? q.terms : [""]) {
    const params = new URLSearchParams({
      size: "50",
      q: [term, q.pi ?? ""].filter(Boolean).join(" "),
    });
    for (const a of parseResearchFi(await getJson(`${RESEARCHFI}?${params}`))) out.set(a.id, a);
  }
  return narrow(q, [...out.values()]);
}

/** RAD-on's POL-on projects: the project manager and the leading institution. Amounts in PLN. */
export function parseRadon(body: unknown): RawAward[] {
  return asArray(asRecord(body).results)
    .map(asRecord)
    .map((p) => {
      const manager = asRecord(asArray(p.projectManagers)[0]);
      const institutions = asArray(p.implementingInstitutions).map(asRecord);
      const lead = institutions.find((i) => text(i.leader) === "Tak") ?? institutions[0];
      const id = text(p.projectNumber) || text(p.projectUuid);
      return {
        source: "RADON" as const,
        id,
        title: text(p.projectTitleEn) || text(p.projectTitlePl),
        pi: [text(manager.firstName), text(manager.lastName)].filter(Boolean).join(" "),
        university: text(lead?.institutionName) || text(manager.institutionName),
        amount: num(p.nationalFunds),
        currency: "PLN",
        url: `https://radon.nauka.gov.pl/opendata/polon/projects?projectNumber=${encodeURIComponent(id)}`,
        starts: day(p.projectStartDate),
        ends: day(p.projectEndDate),
        abstract: (text(p.projectAbstractEn) || text(p.projectAbstractPl)).slice(0, 600),
      };
    });
}

/** RAD-on: projects funded in Poland (NCN, NCBR...), by English title words or the manager's surname. */
export async function radonAwards(q: AwardQuery): Promise<RawAward[]> {
  const out = new Map<string, RawAward>();
  for (const term of q.terms.length ? q.terms : [""]) {
    const params = new URLSearchParams({ resultNumbers: "50" });
    if (term) params.set("projectTitleEn", term);
    if (q.pi) params.set("projectManagerLastName", q.pi.split(/\s+/).at(-1) ?? "");
    const body = await getJson(`https://radon.nauka.gov.pl/opendata/polon/projects?${params}`);
    for (const a of parseRadon(body)) out.set(a.id, a);
  }
  return narrow(q, [...out.values()]);
}

/** "31.12.2028" as "2028-12-31". */
const dmy = (v: unknown) => {
  const [d, m, y] = text(v).split(".");
  return y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
};

/**
 * ETIS, Estonia's research register: every national and EU project with its principal
 * investigator (named in the display line; the responsible executor otherwise) and host, EUR.
 */
export function parseEtis(body: unknown): RawAward[] {
  return asArray(body)
    .map(asRecord)
    .map((p) => {
      const info = text(p.DisplayInfoEng);
      const responsible = asArray(p.Persons)
        .map(asRecord)
        .find((x) => text(x.RoleNameEng) === "Responsible executor");
      const host = asRecord(asArray(p.Institutions)[0]);
      return {
        source: "ETIS" as const,
        funder: text(asRecord(asArray(p.FinancingInstitutions)[0]).NameEng),
        id: text(p.FinancierProjectNr) || text(p.Guid),
        title: text(p.TitleEng) || text(p.Title),
        pi: /Principal Investigator: ([^;]+);/.exec(info)?.[1]?.trim() ?? text(responsible?.Name),
        // "University of Tartu, Faculty of Science and Technology, ..." as the university.
        university: (text(host.NameEng) || text(host.Name)).split(",")[0]?.trim() ?? "",
        amount: num(p.FinancingInPeriodsTotal),
        currency: "EUR",
        url: `https://www.etis.ee/Portal/Projects/Display/${text(p.Guid)}`,
        starts: dmy(p.ProjectStartDate),
        ends: dmy(p.ProjectEndDate),
        abstract: text(p.AnnotationEng).slice(0, 600),
      };
    });
}

/** ETIS: projects whose title contains a term (up to 500 each), with the PI. */
export async function etisAwards(q: AwardQuery): Promise<RawAward[]> {
  const out = new Map<string, RawAward>();
  for (const term of q.terms.length ? q.terms : [""]) {
    const params = new URLSearchParams({ Format: "json", Take: "500", SearchType: "2" });
    if (term) params.set("Title", term);
    const body = await getJson(`https://www.etis.ee:7443/api/project/getitems?${params}`);
    for (const a of parseEtis(body)) out.set(a.id, a);
  }
  return narrow(q, [...out.values()]);
}
