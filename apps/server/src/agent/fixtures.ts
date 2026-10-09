// The fake agent's world: three professors, two scholarships, a program, and free sources that
// answer from fixtures. Emails use example.edu, so nothing here can reach a real person.
import { type ContactRead, readContactRule } from "../contact-page.ts";
import type { RowOp } from "@getmyprof/contracts";
import { TREG_ENDPOINTS } from "../treg.ts";
import type { Sources } from "./tools.ts";

export const FIXTURE_PROFESSORS = [
  {
    name: "Kevin Lybarger",
    university: "George Mason University",
    niche: "clinical NLP",
    fit: 5,
    moneyTier: 2,
    taking: 'yes, "PhD 2027" in the subject',
    money: "NIH team grant $4.65M",
    lasts: "not posted",
    email: "lybarger@example.edu",
    contact: 'email, subject "PhD 2027"',
    subjectRule: "PhD 2027",
    recent:
      "2026 DF-RAG: Query-Aware Diversity for Retrieval-Augmented Generation (ACL); 2026 Efficient Information Extraction Using LLMs and Knowledge Distillation",
    hook: "DF-RAG's per-query passage diversity is the retrieval step your clinical NLP interest needs",
    warm: "Your co-author Ada Fixture wrote with him in 2024: Retrieval for clinical notes at scale",
    sources: ["https://www.kevinlybarger.me/news.html"],
  },
  {
    name: "Mohan Zalake",
    university: "University of Illinois Chicago",
    niche: "LLM agents in health",
    fit: 5,
    moneyTier: 2,
    taking: "yes, join-us page",
    money: "NIA-funded pilot",
    lasts: "not posted",
    email: "zalake@example.edu",
    contact: "follow the join-us page",
    linkedin: "https://www.linkedin.com/in/mohan-zalake",
    recent: "2026-05 LLM agents for patient conversations",
    hook: "His LLM agents for patient conversations fit your health NLP fields",
    warm: "none found",
    sources: ["https://vare.ahs.uic.edu/"],
  },
  {
    name: "Natalie Parde",
    university: "University of Illinois Chicago",
    niche: "health NLP, multimodal",
    fit: 3,
    moneyTier: 2,
    taking: "apply, list me",
    money: "NSF ~$1.2M",
    lasts: "?",
    contact: "apply-only, no cold email",
    stage: "apply-only",
    recent: "2026-02 Multimodal models for health text",
    hook: "Her multimodal models for health text fit your health NLP fields",
    warm: "none found",
    sources: ["https://www.natalieparde.com/team.html"],
  },
];

/** Each fixture professor's own page, as Taking students? reads it: a yes with a subject rule, a
 * not-until-2028 and an apply-first. */
const FIXTURE_PAGES: Record<string, string> = {
  "https://www.kevinlybarger.me/news.html":
    '<p>I am recruiting PhD students for Fall 2027.</p><p>Email me with "PhD 2027" in the subject line and attach your CV.</p>',
  "https://vare.ahs.uic.edu/":
    "<h2>Join us</h2><p>I am not taking new PhD students until Fall 2028.</p>",
  "https://www.natalieparde.com/team.html":
    "<p>Prospective students: please do not email me about admissions. Apply to the PhD program first and mention my name in your statement.</p>",
};

/** What the fake's Taking students? proposes from a page read: their words, dated, and the rules. */
export function takingFields(r: ContactRead) {
  const quote = r.statements[0] ? `: "${r.statements[0]}"` : "";
  const applyOnly = r.noEmail || r.applyFirst || r.form;
  return {
    taking: `${r.taking ?? "not stated"}${quote} (their page, ${r.readOn})`,
    ...(r.subject ? { subjectRule: r.subject } : {}),
    ...(applyOnly
      ? {
          stage: "apply-only",
          contact: r.form ? `form ${r.form}` : `apply-only: "${r.applyFirst ?? r.noEmail}"`,
        }
      : {}),
    sources: r.urls,
  };
}

/**
 * The field and value each simple row action proposes in the fake agent. Recent work and focus,
 * and Warm path and hook, fill several fields from the fixtures instead.
 */
export const ROW_FIELD: Record<Exclude<RowOp, "work" | "personalize">, string> = {
  email: "emailCheck",
  lasts: "lasts",
  taking: "taking",
  lab: "lab",
  draft: "stage",
};
export const ROW_VALUE: Record<Exclude<RowOp, "work" | "personalize">, string> = {
  email: "ok",
  lasts: "checked: no award as PI",
  taking: "not stated",
  lab: "2 on OpenAlex: Ada Fixture, likely a student; Ben Fixture, last paper 2023, now at Fixture Labs. Ask Ada Fixture",
  draft: "drafted",
};

/** What the Recent work and focus row action finds for each fixture professor, beside `recent`. */
export const FIXTURE_WORK: Record<string, { seeking: string; scholar: string }> = {
  "Kevin Lybarger": {
    seeking: "PhD students for clinical NLP and RAG in healthcare",
    scholar: "https://scholar.google.com/citations?user=fixture-lybarger",
  },
  "Mohan Zalake": {
    seeking: "students building health agents, with some HCI background",
    scholar: "https://scholar.google.com/citations?user=fixture-zalake",
  },
  "Natalie Parde": { seeking: "not stated", scholar: "" },
};

/** One concrete detail of each emailed fixture professor's newest paper: first emails name it. */
export const FIXTURE_DETAIL: Record<string, string> = {
  "Kevin Lybarger":
    "It picks passages for diversity per query instead of a fixed top-k, the step I want to try on long clinical notes.",
  "Mohan Zalake":
    "Its agent asks a follow-up question before it answers, and I want to see how that holds with older patients.",
};

/** Schools the scripted agent suggests for the shortlist, one or two per tier. */
export const FIXTURE_SCHOOLS = [
  {
    name: "University of Maryland",
    country: "USA",
    tier: "reach",
    rank: "CSRankings #9, NLP",
    admits: "committee",
    why: "Top 10 in NLP and very selective; every PhD admit is funded.",
    sources: ["https://csrankings.org/#/index?nlp&us"],
  },
  {
    name: "George Mason University",
    country: "USA",
    tier: "match",
    rank: "CSRankings #52",
    admits: "committee",
    why: "Mid-ranked in NLP with three health NLP groups that fit your fields; admits funded 5 years.",
    sources: ["https://csrankings.org/#/index?nlp&us"],
  },
  {
    name: "University of Illinois Chicago",
    country: "USA",
    tier: "match",
    rank: "CSRankings #48",
    admits: "committee",
    why: "Health NLP and LLM agent labs with active grants past 2028.",
    sources: ["https://csrankings.org/#/index?nlp&us"],
  },
  {
    name: "Kansas State University",
    country: "USA",
    tier: "safety",
    rank: "CSRankings #120",
    admits: "committee",
    why: "Funds every PhD admit and waives the fee with a medium-of-instruction certificate.",
    sources: ["https://www.k-state.edu/grad/"],
  },
] as const;

/** What the scripted agent finds George Mason pays and costs when it checks programs there. */
export const FIXTURE_SCHOOL_MONEY = {
  name: "George Mason University",
  stipendUsd: 32000,
  rentUsd: 1100,
  source: "https://cec.gmu.edu/academics/doctoral-programs/phd-information-technology",
};

/** Last cycle's timing the scripted agent notes on every Vault program. */
export const FIXTURE_DECISIONS = {
  decisions: "interviews late Jan; decisions Feb 10 to Mar 5 (14 reports, 4 international)",
  source: "https://www.thegradcafe.com/survey",
};

export const FIXTURE_SCHOLARSHIPS = [
  {
    name: "Fulbright Foreign Student Program",
    sponsor: "US Department of State",
    studyIn: "USA",
    citizenship: ["Bangladesh"],
    tracks: ["phd", "ms_phd", "funded_ms"],
    amount: "tuition, stipend, travel",
    deadline: "2027-02-15",
    url: "https://bd.usembassy.gov/education-culture/fulbright/",
    sources: ["https://bd.usembassy.gov/education-culture/fulbright/"],
    why: "open to Bangladeshi citizens for a US master's or PhD",
  },
  {
    name: "Chevening Scholarship",
    sponsor: "UK Foreign Office",
    studyIn: "UK",
    citizenship: [],
    tracks: ["funded_ms"],
    amount: "tuition, stipend, flights",
    deadline: "2026-11-04",
    url: "https://www.chevening.org/",
    sources: ["https://www.chevening.org/"],
    why: "one-year UK master's; only fits a funded-master's track",
  },
];

export const FIXTURE_PROGRAMS = [
  {
    university: "George Mason University",
    name: "PhD in Information Technology",
    degree: "phd",
    deadline: "2026-12-01",
    fee: "$75",
    waiver: "on request for international applicants",
    english: "IELTS 6.5; MOI considered",
    funding: "GRA/GTA for most admits",
    asks: "Your research interests and the problems you want to work on\nWhy this program and which faculty",
    limit: "2 pages",
    eligibility: "ok",
    url: "https://cec.gmu.edu/academics/doctoral-programs/phd-information-technology",
    sources: ["https://cec.gmu.edu/academics/doctoral-programs/phd-information-technology"],
    why: "Lybarger and Yao advise through it",
  },
];

export const fixtureSources: Sources = {
  nsf: async () => [
    {
      source: "NSF",
      id: "2439202",
      title:
        "CAREER: Leveraging Grammar Books to Develop Language Technologies for Data-Scarce Languages",
      pi: "Antonios Anastasopoulos",
      university: "George Mason University",
      amount: 599956,
      currency: "USD",
      url: "https://www.nsf.gov/awardsearch/showAward?AWD_ID=2439202",
      starts: "2025-06-15",
      ends: "2030-05-31",
      abstract: "Fixture award.",
    },
  ],
  nih: async () => [],
  ukri: async () => [
    {
      source: "UKRI",
      id: "EP/Y000001/1",
      title: "Fixture: trustworthy language models for health",
      pi: "Jane Fixture",
      university: "University of Edinburgh",
      amount: 812000,
      currency: "GBP",
      url: "https://gtr.ukri.org/projects?ref=EP%2FY000001%2F1",
      starts: "2025-01-01",
      ends: "2029-12-31",
      abstract: "Fixture award.",
    },
  ],
  cordis: async () => [],
  arc: async () => [],
  dfg: async () => [
    {
      source: "DFG",
      id: "558595415",
      title: "Fixture: large language models for production control",
      pi: "Marvin May",
      university: "Technical University of Munich",
      amount: null,
      currency: "EUR",
      url: "https://gepris.dfg.de/gepris/projekt/558595415",
      starts: "2025-01-01",
      ends: "2029-12-31",
      abstract: "Fixture award.",
    },
  ],
  nserc: async () => [],
  jobsacuk: async () => [
    {
      source: "jobs.ac.uk",
      id: "1083400",
      title: "PhD Studentship: Language models for health records",
      professor: "Jane Fixture",
      university: "University of Edinburgh",
      country: "United Kingdom",
      funding: "Funding: fully funded. Standard EPSRC stipend",
      deadline: "2026-11-04",
      posted: "2026-08-04",
      url: "https://www.jobs.ac.uk/job/DSK809/fixture",
      abstract: "Fixture posting.",
    },
  ],
  inspire: async () => [],
  csrankings: async (university) =>
    university.toLowerCase().includes("george mason")
      ? [
          {
            name: "Ziyu Yao",
            homepage: "https://ziyuyao.org",
            scholar: "https://scholar.google.com/citations?user=fixture",
          },
        ]
      : [],
  byTopic: async (topic) => [
    {
      name: "Ziyu Yao",
      works: 61,
      citations: 2400,
      topics: [topic, "Topic Modeling"],
      link: "https://openalex.org/A0000000001",
    },
  ],
  adjacent: async () => [
    "Computational linguistics",
    "Health informatics",
    "Information retrieval",
  ],
  openalex: async (name) => ({
    name,
    institution: "Fixture University",
    works: 42,
    citations: 900,
    topics: ["NLP"],
    recent: [
      {
        title: "Query-aware retrieval for clinical notes",
        date: "2026-08-14",
        link: "https://doi.org/10.5555/fixture.1",
      },
      {
        title: "Small language models for health text",
        date: "2026-03-02",
        link: "https://doi.org/10.5555/fixture.2",
      },
    ],
  }),
  lab: async (name) => ({
    name,
    institution: "Fixture University",
    works: 24,
    since: 2021,
    coAuthors: [
      {
        id: "A0000000002",
        name: "Ada Fixture",
        link: "https://openalex.org/A0000000002",
        shared: 6,
        lastYear: 2026,
        institution: "Fixture University",
        now: "",
        student: true,
        alumnus: false,
      },
      {
        id: "A0000000003",
        name: "Ben Fixture",
        link: "https://openalex.org/A0000000003",
        shared: 3,
        lastYear: 2023,
        institution: "Fixture University",
        now: "Fixture Labs",
        student: false,
        alumnus: true,
      },
    ],
  }),
  warm: async (name, _university, papers) => ({
    name,
    found: papers.slice(0, 1),
    direct: [],
    paths: [
      {
        via: "Ada Fixture",
        title: "Retrieval for clinical notes at scale",
        year: 2024,
        link: "https://doi.org/10.5555/fixture.3",
      },
    ],
  }),
  contactPage: async (url) =>
    readContactRule(
      [{ url, html: FIXTURE_PAGES[url] ?? "<p>Research on language.</p>" }],
      new Date(),
    ),
  treg: async (req) => ({
    ok: true,
    result:
      req.endpoint === "fetchinio.linkedin.user.profile"
        ? { profileId: "ACoAAFixtureMember", firstName: "Fixture" }
        : "deliverable",
    callId: `fake-${req.endpoint}`,
    costUsd: TREG_ENDPOINTS[req.endpoint]?.usd ?? 0,
  }),
};
