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
  openalex: async (name) => ({
    name,
    institution: "Fixture University",
    works: 42,
    citations: 900,
    topics: ["NLP"],
    recent: [],
  }),
  treg: async (req) => ({
    ok: true,
    result: "deliverable",
    callId: `fake-${req.endpoint}`,
    costUsd: TREG_ENDPOINTS[req.endpoint]?.usd ?? 0,
  }),
};
