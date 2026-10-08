// The fake agent's world: three professors, two scholarships, a program, and free sources that
// answer from fixtures. Emails use example.edu, so nothing here can reach a real person.
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
    sources: ["https://www.natalieparde.com/team.html"],
  },
];

/** What the Recent work and focus row action finds for each fixture professor. */
export const FIXTURE_WORK: Record<string, { recent: string; seeking: string; scholar: string }> = {
  "Kevin Lybarger": {
    recent:
      "2026 DF-RAG: Query-Aware Diversity for Retrieval-Augmented Generation (ACL); 2026 Efficient Information Extraction Using LLMs and Knowledge Distillation",
    seeking: "PhD students for clinical NLP and RAG in healthcare",
    scholar: "https://scholar.google.com/citations?user=fixture-lybarger",
  },
  "Mohan Zalake": {
    recent: "2026-05 LLM agents for patient conversations",
    seeking: "students building health agents, with some HCI background",
    scholar: "https://scholar.google.com/citations?user=fixture-zalake",
  },
  "Natalie Parde": {
    recent: "2026-02 Multimodal models for health text",
    seeking: "not stated",
    scholar: "",
  },
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
