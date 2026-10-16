// National grant files: big public CSVs, downloaded at most once a month into
// GETMYPROF_HOME/cache and searched in memory. Each source is a spec, where its file lives and how
// one row reads as an award: NSERC (Canada), Research Ireland and SFI, RCN (Norway), ANID (Chile).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseCsv } from "./adapters.ts";
import { homeDir } from "./db.ts";
import {
  type AwardQuery,
  asArray,
  asRecord,
  getJson,
  narrow,
  type RawAward,
  text,
} from "./sources.ts";

const MONTH = 30 * 864e5;

/**
 * A big public file, downloaded at most once a month into GETMYPROF_HOME/cache, as text in its
 * encoding ("utf-8" drops a byte-order mark; Irish files are "windows-1252"). A URL that must be
 * looked up is looked up only when the cached copy is missing or stale.
 */
export async function cached(
  name: string,
  where: string | (() => Promise<string>),
  encoding = "utf-8",
) {
  const file = NodePath.join(homeDir(), "cache", name);
  const decode = (bytes: Uint8Array) => new TextDecoder(encoding).decode(bytes);
  try {
    if (Date.now() - NodeFS.statSync(file).mtimeMs < MONTH)
      return decode(NodeFS.readFileSync(file));
  } catch {
    // Not there yet.
  }
  const url = typeof where === "string" ? where : await where();
  const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, bytes);
  return decode(bytes);
}

/** Whether any term is in the text; no terms match everything. */
export const matches = (haystack: string, terms: string[]) => {
  const h = haystack.toLowerCase();
  return terms.length === 0 || terms.some((t) => h.includes(t.toLowerCase()));
};

export type FileSpec = {
  /** Tried in order until one answers: its cache name and URL, or how to find today's URL. */
  files: { name: string; url: string | (() => Promise<string>) }[];
  /** A TextDecoder label; utf-8 when not set. */
  encoding?: string;
  delimiter?: string;
  /** One row, read by column name, as an award; null when it isn't a funded PI's grant. */
  award: (get: (column: string) => string) => RawAward | null;
};

/** A file's rows as awards. Columns match by name, or by prefix ("Name" for "Name-Nom"). */
export function readAwards(spec: FileSpec, csv: string) {
  const [head = [], ...rows] = parseCsv(csv, spec.delimiter);
  const names = head.map((h) => h.replace(/^\W+/, "").trim());
  const at = new Map<string, number>();
  const index = (c: string) => {
    if (!at.has(c)) {
      const exact = names.indexOf(c);
      at.set(c, exact >= 0 ? exact : names.findIndex((n) => n.startsWith(c)));
    }
    return at.get(c) ?? -1;
  };
  return rows.flatMap((r) => spec.award((c) => r[index(c)]?.trim() ?? "") ?? []);
}

const loaded = new Map<FileSpec, Promise<RawAward[]>>();

async function load(spec: FileSpec) {
  for (const f of spec.files) {
    try {
      return readAwards(spec, await cached(f.name, f.url, spec.encoding));
    } catch {
      // Try the next file.
    }
  }
  throw new Error(`${spec.files[0]?.name ?? "a grant file"} is unreachable`);
}

/** A source over a file spec: loads it once, then filters by terms, school, PI and end date. */
export const fileAwards =
  (spec: FileSpec) =>
  async (q: AwardQuery): Promise<RawAward[]> => {
    let all = loaded.get(spec);
    if (!all) {
      all = load(spec);
      loaded.set(spec, all);
      all.catch(() => loaded.delete(spec));
    }
    const hits = (await all).filter((a) => matches(`${a.title} ${a.abstract}`, q.terms));
    return narrow(q, hits)
      .slice(0, 50)
      .map((a) => ({ ...a, abstract: a.abstract.slice(0, 600) }));
  };

/** A number in "€ 645,734.00" or "24000"; null when absent or not positive. */
const amount = (s: string) => Number(s.replace(/[^\d.-]/g, "")) || null;
/** "1/31/2028" as "2028-01-31". */
const usDate = (s: string) => {
  const [m, d, y] = s.split("/");
  return y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
};
/** "ALFREDO VEGA LOPEZ" as "Alfredo Vega Lopez". */
const titleCase = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s(-])\p{L}/gu, (c) => c.toUpperCase());

/**
 * NSERC's open data, the latest fiscal year's file (about 56 MB). Amounts are per year; a
 * Discovery Grant runs five years from its competition year, so the end date is that, to March 31.
 */
export const NSERC: FileSpec = {
  files: ["2024", "2023"].map((fy) => ({
    name: `nserc-FY${fy}.csv`,
    url: `https://www.nserc-crsng.gc.ca/opendata/NSERC_FY${fy}_Expenditures.csv`,
  })),
  award: (get) => {
    const competed = Number(get("CompetitionYear"));
    return {
      source: "NSERC",
      id: get("ApplicationID"),
      title: get("ApplicationTitle"),
      // "Smol, John JP" as "John JP Smol".
      pi: get("Name").split(",").toReversed().join(" ").trim(),
      university: get("Institution"),
      amount: amount(get("AwardAmount")),
      currency: "CAD",
      url: "https://www.nserc-crsng.gc.ca/ase-oro/index_eng.asp",
      starts: competed ? `${competed}-04-01` : null,
      ends: competed ? `${competed + 5}-03-31` : null,
      // The whole summary, so a search reads all of it; results are cut to 600 characters.
      abstract: `${get("ProgramNameEN")}. Amount is per year. ${get("Keywords")}. ${get("ApplicationSummary")}`,
    };
  },
};

/** Research Ireland's grant commitments since 2025; the file's URL changes with each release. */
export const RESEARCH_IRELAND: FileSpec = {
  files: [
    {
      name: "research-ireland.csv",
      url: async () => {
        const pkg = asRecord(
          await getJson(
            "https://data.gov.ie/api/3/action/package_show?id=research-ireland-grant-commitments",
          ),
        );
        const csv = asArray(asRecord(pkg.result).resources)
          .map(asRecord)
          .find((r) => /csv/i.test(text(r.format)));
        if (!csv) throw new Error("data.gov.ie lists no CSV");
        return text(csv.url);
      },
    },
  ],
  encoding: "windows-1252",
  award: (get) => ({
    source: "IRELAND",
    funder: get("Funder Name"),
    id: get("Project ID"),
    title: get("Project title"),
    pi: get("Lead Applicant"),
    university: get("Research Body"),
    amount: amount(get("Award Amount")),
    currency: "EUR",
    url: "https://data.gov.ie/dataset/research-ireland-grant-commitments",
    starts: usDate(get("Actual Start Date")),
    ends: usDate(get("Final End Date")),
    abstract: get("Programme Name"),
  }),
};

/** Science Foundation Ireland's commitments to July 2024, before it became Research Ireland. */
export const SFI: FileSpec = {
  files: [
    {
      name: "sfi.csv",
      url: "https://www.sfi.ie/about-us/governance/open-data/Open-Data-2024-07-31.csv",
    },
  ],
  encoding: "windows-1252",
  award: (get) => ({
    source: "IRELAND",
    funder: get("Funder Name"),
    id: get("Proposal ID"),
    title: get("Proposal Title"),
    pi: get("Lead Applicant"),
    university: get("Research Body").replace(/\s*\([A-Z]+\)$/, ""),
    amount: amount(get("Current Total Commitment")),
    currency: "EUR",
    url: "https://data.gov.ie/dataset/science-foundation-ireland-grants-commitments",
    starts: get("Start Date") || null,
    ends: get("End Date") || null,
    abstract: [get("Programme Name"), get("Sub-Programme")].filter(Boolean).join(". "),
  }),
};

/**
 * RCN's short names for the hosts where most PhDs are, in the English an applicant types. Others
 * fall back to the project's own host line, often a department.
 */
const RCN_HOSTS: Record<string, string> = {
  UIO: "University of Oslo",
  NTNU: "Norwegian University of Science and Technology (NTNU)",
  UIB: "University of Bergen",
  UIT: "UiT The Arctic University of Norway",
  NMBU: "Norwegian University of Life Sciences (NMBU)",
  OSLOMET: "OsloMet - Oslo Metropolitan University",
  UIS: "University of Stavanger",
  UIA: "University of Agder",
  USN: "University of South-Eastern Norway",
  NORD: "Nord University",
  NHH: "Norwegian School of Economics (NHH)",
  BI: "BI Norwegian Business School",
  HVL: "Western Norway University of Applied Sciences",
  OUS: "Oslo University Hospital",
};

/** The Research Council of Norway's projects (54 MB): granted ones only, with the PhD years each funds. */
export const RCN: FileSpec = {
  files: [
    {
      name: "rcn.csv",
      url: "https://raw.githubusercontent.com/Forskningsradet/open-data/main/datasets/soknader2/dataset.csv",
    },
  ],
  award: (get) => {
    // Bevilgning is granted and running, Avsluttet granted and ended; the rest were never funded.
    if (!["Bevilgning", "Avsluttet"].includes(get("prosjektfase"))) return null;
    const id = get("prosjektnummer");
    const phd = Number(get("dr_stip_aarsverk"));
    const host = RCN_HOSTS[get("kortnavn")] ?? (get("prosjektansvarlig_navn") || get("kortnavn"));
    return {
      source: "RCN",
      id,
      title: get("prosjekttittel"),
      pi: get("prosjektleder"),
      // Some hosts come in capitals: "UNIVERSITETET I OSLO".
      university: host === host.toUpperCase() ? titleCase(host) : host,
      amount: amount(get("tildelt_belop")),
      currency: "NOK",
      url: `https://prosjektbanken.forskningsradet.no/project/FORISS/${id}`,
      starts: get("prosjektstart") ? `${get("prosjektstart")}-01-01` : null,
      ends: get("prosjektslutt") ? `${get("prosjektslutt")}-12-31` : null,
      abstract: [get("aktivitet"), get("fagdisiplin"), phd > 0 ? `Funds ${phd} PhD years.` : ""]
        .filter(Boolean)
        .join(". "),
    };
  },
};

/** ANID's awarded projects (Chile), FONDECYT and the rest; scholarships and postdocs left out. */
export const ANID: FileSpec = {
  files: [
    {
      name: "anid.csv",
      url: "https://raw.githubusercontent.com/ANID-GITHUB/Historico-de-Proyectos-Adjudicados/master/BDH_HISTORICA.csv",
    },
  ],
  delimiter: ";",
  award: (get) => {
    if (get("SUBDIRECCION") === "CAPITAL HUMANO" || get("INSTRUMENTO") === "POSTDOCTORADO")
      return null;
    const year = Number(get("AGNO_FALLO"));
    // shortcut: a missing duration (old rows mostly) counts as four years, FONDECYT's longest.
    const months = Number(get("DURACION_MESES")) || 48;
    const end = year ? new Date(Date.UTC(year, months, 0)) : null;
    const value = amount(get("MONTO_ADJUDICADO"));
    const euros = /euro/i.test(get("MONEDA"));
    return {
      source: "ANID",
      id: get("CODIGO_PROYECTO"),
      title: get("NOMBRE_PROYECTO"),
      pi: titleCase(get("NOMBRE_RESPONSABLE")),
      university: titleCase(get("INSTITUCION_PRINCIPAL")),
      // Pesos are in thousands (M$).
      amount: value && !euros ? value * 1000 : value,
      currency: euros ? "EUR" : "CLP",
      url: "https://github.com/ANID-GITHUB/Historico-de-Proyectos-Adjudicados",
      starts: year ? `${year}-01-01` : null,
      ends: end?.toISOString().slice(0, 10) ?? null,
      abstract: [get("INSTRUMENTO"), get("DISCIPLINA_DETALLE"), get("PALABRAS_CLAVES")]
        .filter(Boolean)
        .join(". "),
    };
  },
};

export const nsercAwards = fileAwards(NSERC);
export const rcnAwards = fileAwards(RCN);
export const anidAwards = fileAwards(ANID);
/** Both Irish files: grants committed since 2025, and SFI's before, many still running. */
export const irelandAwards = async (q: AwardQuery) => {
  const [now, before] = await Promise.all([
    fileAwards(RESEARCH_IRELAND)(q),
    fileAwards(SFI)(q).catch(() => []),
  ]);
  return [...now, ...before].slice(0, 50);
};
