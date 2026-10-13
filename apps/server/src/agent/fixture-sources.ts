// The fake agent's free sources: awards, positions, OpenAlex and treg answered from fixtures, so
// every flow runs without a network or a key.
import { readContactRule } from "../contact-page.ts";
import { TREG_ENDPOINTS } from "../treg.ts";
import { FIXTURE_PAGES } from "./fixtures.ts";
import type { Sources } from "./tools.ts";

const award = {
  title: "Fixture: machine learning for large 3D tomographic images",
  university: "CWI - Centrum Wiskunde & Informatica",
  amount: 249837,
  url: "https://www.nwo.nl/en/projects/016.Veni.192.235",
  starts: "2025-09-01",
  ends: "2030-02-28",
  abstract: "Fixture award.",
};

const posting = {
  deadline: "2026-11-04",
  posted: "2026-08-04",
  abstract: "Fixture posting.",
};

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
  openalexAwards: async () => [],
  // One European award that names its PI, so Add PI has something to propose in the fake.
  nwo: async () => [
    { ...award, source: "NWO", id: "016.Veni.192.235", pi: "Daniël Pelt", currency: "EUR" },
  ],
  researchfi: async () => [],
  radon: async () => [],
  jobsacuk: async () => [
    {
      ...posting,
      source: "jobs.ac.uk",
      id: "1083400",
      title: "PhD Studentship: Language models for health records",
      professor: "Jane Fixture",
      university: "University of Edinburgh",
      country: "United Kingdom",
      funding: "Funding: fully funded. Standard EPSRC stipend",
      kind: "scholarship",
      url: "https://www.jobs.ac.uk/job/DSK809/fixture",
    },
  ],
  inspire: async () => [],
  daad: async () => [
    {
      ...posting,
      source: "DAAD",
      id: "10485",
      title: "PhD Position in electrocatalysis",
      professor: "Nikolay Fixture",
      university: "University of Bonn",
      country: "Germany",
      funding: "TV-L E13, 50%",
      kind: "employment",
      url: "https://www.daad.de/en/studying-in-germany/phd-studies-research/phd-germany/detail/10485/",
    },
  ],
  academictransfer: async () => [],
  mur: async () => [],
  csrankings: async (university) =>
    university.toLowerCase().includes("george mason")
      ? [
          {
            name: "Ziyu Yao",
            homepage: "https://ziyuyao.org",
            scholar: "https://scholar.google.com/citations?user=fixture",
            venues: "acl 6, emnlp 4, naacl 2",
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
  paperEmails: async () => [],
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
