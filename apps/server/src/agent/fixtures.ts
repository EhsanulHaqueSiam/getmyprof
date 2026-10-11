// The fake agent's world: three professors, two scholarships, a program and their pages; the free
// sources that answer from them live in fixture-sources.ts. Emails use example.edu, so nothing
// here can reach a real person.
import type { ContactRead } from "../contact-page.ts";
import type { RowOp } from "@getmyprof/contracts";

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

/**
 * What the fake agent answers for each portal field in a [portal] turn, by its label: the first
 * of a select's or radio's options, like the real agent is told to, else a fixture line.
 */
export function portalTurn(text: string) {
  const answers = [...text.matchAll(/^- (.+?) \| .*$/gm)].map(([line, label = ""]) => ({
    label,
    value: /options: ([^;\n]+)/.exec(line)?.[1]?.trim() ?? `Fixture answer for ${label}`,
    source: "fixture",
  }));
  return {
    args: { applicationId: /app=(\S+)/.exec(text)?.[1], answers },
    said: `Answered ${answers.length} portal field${answers.length === 1 ? "" : "s"}.`,
  };
}

/** Each fixture professor's own page, as Taking students? reads it: a yes with a subject rule, a
 * not-until-2028 and an apply-first. */
export const FIXTURE_PAGES: Record<string, string> = {
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
    name: "ISTA (Institute of Science and Technology Austria)",
    country: "Austria",
    kind: "institute",
    cycle: "opens late Oct 2026, closes 8 Jan 2027; starts Sep 2027",
    tier: "reach",
    rank: "",
    admits: "committee",
    why: "Its own funded PhD, no rank; machine learning groups fit your fields.",
    sources: ["https://phd.pages.ista.ac.at/phd-application-admission/"],
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
    admitRate: "31% of PhD applicants, 2025 (department report)",
    gpaMin: "3.0 / 4.0",
    url: "https://cec.gmu.edu/academics/doctoral-programs/phd-information-technology",
    sources: ["https://cec.gmu.edu/academics/doctoral-programs/phd-information-technology"],
    why: "Lybarger and Yao advise through it",
  },
];
