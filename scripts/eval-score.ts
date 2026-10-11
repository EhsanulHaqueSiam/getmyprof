// The benchmark eval-hunt.ts runs, and how a run is scored against it. The reference list is who a
// top-tier hunt should find: funded PIs in the field (NSF, NIH) and NLP faculty CSRankings counts
// (2+ ACL, EMNLP or NAACL papers since 2020). Facts are checked on the pages the agent cited, read
// through treg's free fetch so pages built with JavaScript read too. No OpenAlex: its keyless
// budget is 1,000 credits a day.
import { sameSchool, sameSchoolName } from "../packages/contracts/src/domain.ts";
import { asArray, asRecord, text } from "../apps/server/src/sources.ts";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const BENCH = {
  schools: [
    { name: "University of Utah", domain: "utah.edu" },
    { name: "George Mason University", domain: "gmu.edu" },
  ],
  prefs: {
    degrees: ["phd" as const],
    intake: "Fall 2027",
    fallbackIntake: "Spring 2028",
    places: ["USA"],
    fields: ["natural language processing", "clinical NLP"],
    adjacent: ["machine learning for health"],
    fundingFloor: "full" as const,
    preferTestWaivers: false,
    sweep: { reach: 2, match: 3, safety: 2 },
    priorities: ["money" as const, "topic" as const, "recruiting" as const],
    followUpDays: [7, 14] as [number, number],
  },
  /** Award phrases that put a grant in the field. */
  terms: [
    "natural language processing",
    "computational linguistics",
    "clinical text",
    "text mining",
  ],
  intakeStart: "2027-09-01",
  message:
    "Find every professor at these schools who could fund a PhD student in my fields for Fall 2027, funded or not yet, and propose each one with sources.",
};

export type Run = {
  label: string;
  minutes: number;
  status: string;
  treg: boolean;
  spendUsd: number;
  tools: Record<string, number>;
  turnLog: string;
  professors: Record<string, string>[];
  reply: string;
};

type Ref = { name: string; school: string; why: string };
type Verdict = "ok" | "bad" | "unknown" | "none";

const rows = (v: unknown) => asArray(v).map(asRecord);
const getJson = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return asRecord(await r.json());
};
/** First initial and last name: "Antonis" and "Antonios Anastasopoulos" are one person. */
const who = (name: string) => {
  const w = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/^(.*), (.*)$/, "$2 $1")
    .split(/[^a-z]+/)
    .filter((x) => x.length > 1);
  return `${w[0]?.[0] ?? ""} ${w.at(-1) ?? ""}`;
};
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");

const tregToken = () =>
  text(
    asRecord(
      JSON.parse(NodeFS.readFileSync(NodePath.join(NodeOS.homedir(), ".treg/config.json"), "utf8")),
    ).token,
  );

/** A page's text through treg's free fetch (renders JavaScript), else a plain GET. */
async function pageText(url: string) {
  try {
    const r = await getJson("https://treg.to/call/tinyfish.web.fetch", {
      method: "POST",
      headers: { "X-Treg-Token": tregToken(), "content-type": "application/json" },
      body: JSON.stringify({ urls: [url], format: "markdown" }),
    });
    const page = text(rows(r.results)[0]?.text);
    if (page) return plain(page);
  } catch {
    // Fall through to a plain fetch.
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  return plain((await r?.text().catch(() => "")) ?? "").replace(/<[^>]+>/g, " ");
}

const urlsIn = (s: string) => s.match(/https?:\/\/[^\s,;)"]+/g) ?? [];

// ---------------------------------------------------------------- the reference list

const REF_CACHE = "/tmp/gmp-eval-ref.json";
const NLP_VENUES = new Set(["acl", "emnlp", "naacl"]);

async function funded(school: string): Promise<Ref[]> {
  const out: Ref[] = [];
  const [y, m, d] = BENCH.intakeStart.split("-");
  for (const term of BENCH.terms) {
    const nsf = await getJson(
      `https://api.nsf.gov/services/v1/awards.json?keyword="${encodeURIComponent(term)}"&awardeeName="${encodeURIComponent(school)}"&expDateStart=${m}/${d}/${y}&printFields=id,piFirstName,piLastName&rpp=25`,
    );
    for (const a of rows(asRecord(nsf.response).award))
      out.push({
        name: `${text(a.piFirstName)} ${text(a.piLastName)}`,
        school,
        why: `NSF ${text(a.id)}`,
      });
  }
  const nih = await getJson("https://api.reporter.nih.gov/v2/projects/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      criteria: {
        org_names: [school],
        project_end_date: { from_date: BENCH.intakeStart },
        advanced_text_search: {
          operator: "or",
          search_field: "projecttitle,terms,abstracttext",
          search_text: BENCH.terms.map((t) => `"${t}"`).join(" "),
        },
      },
      include_fields: ["ProjectNum", "ContactPiName"],
      limit: 100,
    }),
  });
  for (const p of rows(nih.results))
    out.push({ name: text(p.contact_pi_name), school, why: `NIH ${text(p.project_num)}` });
  return out;
}

/** NLP faculty CSRankings counts at the school: 2+ ACL, EMNLP or NAACL papers since 2020. */
async function nlpFaculty(school: string): Promise<Ref[]> {
  const file = "/tmp/gmp-csrankings-authors.csv";
  if (!NodeFS.existsSync(file)) {
    const r = await fetch(
      "https://raw.githubusercontent.com/emeryberger/CSrankings/gh-pages/generated-author-info.csv",
    );
    NodeFS.writeFileSync(file, await r.text());
  }
  const papers = new Map<string, number>();
  for (const line of NodeFS.readFileSync(file, "utf8").split("\n").slice(1)) {
    const [name = "", dept = "", area = "", count = "0", , year = "0"] = line.split(",");
    if (NLP_VENUES.has(area) && Number(year) >= 2020 && sameSchoolName(dept, school))
      papers.set(name, (papers.get(name) ?? 0) + Number(count));
  }
  return [...papers]
    .filter(([, n]) => n >= 2)
    .map(([name, n]) => ({
      name: name.replace(/\s+\d{4}$/, ""),
      school,
      why: `CSRankings ${n} NLP papers`,
    }));
}

async function references() {
  if (NodeFS.existsSync(REF_CACHE))
    return JSON.parse(NodeFS.readFileSync(REF_CACHE, "utf8")) as { funded: Ref[]; faculty: Ref[] };
  const one = (list: Ref[]) => [...new Map(list.map((r) => [who(r.name), r])).values()];
  const refs = { funded: [] as Ref[], faculty: [] as Ref[] };
  for (const s of BENCH.schools) {
    refs.funded.push(...one(await funded(s.name)));
    refs.faculty.push(...(await nlpFaculty(s.name)));
  }
  NodeFS.writeFileSync(REF_CACHE, JSON.stringify(refs));
  return refs;
}

// ---------------------------------------------------------------- checking each fact

const NOT_THEIRS = /openalex\.org|nsf\.gov|reporter\.nih|x\.com|twitter\.com|scholar\.google/;

/** A page of theirs (not a database) naming them and the school: who they are, and that they're there. */
async function checkIdentity(p: Record<string, string>, school: { name: string; domain: string }) {
  const last = who(p.name ?? "").split(" ")[1] ?? "";
  const pages = urlsIn(`${p.website ?? ""} ${p.sources ?? ""}`).filter((u) => !NOT_THEIRS.test(u));
  for (const url of pages.slice(0, 3)) {
    const page = await pageText(url);
    const there =
      new URL(url).hostname.endsWith(school.domain) ||
      page.includes(school.domain) ||
      plain(school.name)
        .split(" ")
        .filter((w) => w.length > 3 && w !== "university")
        .every((w) => page.includes(w));
    if (page.includes(last) && there) return "ok";
  }
  return pages.length ? "bad" : "unknown";
}

/** Money tier 1 or 2 rests on a page or award that names them. */
async function checkMoney(p: Record<string, string>): Promise<Verdict> {
  const tier = Number(p.moneyTier ?? 0);
  if (tier !== 1 && tier !== 2) return "none";
  const last = who(p.name ?? "").split(" ")[1] ?? "";
  for (const url of urlsIn(`${p.sources ?? ""} ${p.grants ?? ""} ${p.money ?? ""}`)) {
    const nsf = /AWD_ID=(\d+)/.exec(url)?.[1];
    if (nsf) {
      const a = rows(
        asRecord(
          (
            await getJson(
              `https://api.nsf.gov/services/v1/awards/${nsf}.json?printFields=piLastName`,
            )
          ).response,
        ).award,
      )[0];
      if (plain(text(a?.piLastName)).includes(last)) return "ok";
      continue;
    }
    if ((await pageText(url)).includes(last)) return "ok";
  }
  return "bad";
}

/** A quoted contact rule is on the page it came from, word for word. */
async function checkQuote(p: Record<string, string>): Promise<Verdict> {
  const quote = /"([^"]{20,})"/.exec(`${p.taking ?? ""} ${p.contact ?? ""}`)?.[1];
  if (!quote) return "none";
  const want = plain(quote).slice(0, 50);
  const pages = urlsIn(`${p.website ?? ""} ${p.sources ?? ""}`).filter((u) => !NOT_THEIRS.test(u));
  for (const url of pages.slice(0, 4)) if ((await pageText(url)).includes(want)) return "ok";
  return pages.length ? "bad" : "unknown";
}

const checkEmail = (p: Record<string, string>, domain: string): Verdict =>
  !p.email ? "none" : p.email.toLowerCase().endsWith(domain) ? "ok" : "bad";

/** Deliverable is ok; a catch-all .edu can't be told either way. */
const checkDelivery = (p: Record<string, string>): Verdict =>
  !p.email
    ? "none"
    : /catch/i.test(p.emailCheck ?? "")
      ? "unknown"
      : /verif|deliver|valid/i.test(p.emailCheck ?? "")
        ? "ok"
        : "bad";

export async function score(run: Run) {
  const refs = await references();
  const found = (r: Ref) =>
    run.professors.some(
      (p) => who(p.name ?? "") === who(r.name) && sameSchool(p.university ?? "", r.school),
    );
  const checks = await Promise.all(
    run.professors.map(async (p) => {
      const at = BENCH.schools.find((s) => sameSchool(p.university ?? "", s.name));
      return {
        name: p.name ?? "",
        atSchool: at ? "ok" : "bad",
        identity: at ? await checkIdentity(p, at) : "bad",
        emailDomain: at ? checkEmail(p, at.domain) : "none",
        delivery: checkDelivery(p),
        money: await checkMoney(p),
        quote: await checkQuote(p),
      } satisfies Record<string, string>;
    }),
  );
  const tally = (k: Exclude<keyof (typeof checks)[number], "name">) => ({
    ok: checks.filter((c) => c[k] === "ok").length,
    bad: checks.filter((c) => c[k] === "bad").length,
    unknown: checks.filter((c) => c[k] === "unknown").length,
  });
  return {
    run: { label: run.label, minutes: run.minutes, status: run.status, treg: run.treg },
    quantity: {
      proposed: run.professors.length,
      withEmail: run.professors.filter((p) => p.email).length,
      funded: `${refs.funded.filter(found).length} of ${refs.funded.length}`,
      fundedMissed: refs.funded.filter((r) => !found(r)).map((r) => `${r.name} (${r.why})`),
      faculty: `${refs.faculty.filter(found).length} of ${refs.faculty.length}`,
      facultyMissed: refs.faculty.filter((r) => !found(r)).map((r) => `${r.name} (${r.why})`),
    },
    quality: Object.fromEntries(
      (["atSchool", "identity", "emailDomain", "delivery", "money", "quote"] as const).map((k) => [
        k,
        tally(k),
      ]),
    ),
    failures: checks.filter((c) => Object.values(c).includes("bad")),
    cost: { tregUsd: run.spendUsd, toolCalls: run.tools, model: run.turnLog },
  };
}
