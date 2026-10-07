// The vendor list as named tools, one job each (find_email, web_search...), so the agent picks
// a job rather than an endpoint id. Each runs exactly as the treg tool does: priced, capped,
// logged under treg's call id. They appear only while treg is connected.
import { z } from "zod";
import { TREG_ENDPOINTS } from "../treg.ts";
import type { HuntTool } from "./tools.ts";

const JOBS = [
  [
    "find_email",
    "treg.people.email.find",
    "Find a professor's work email when no official page lists one",
    "full_name and domain, or linkedin_url",
  ],
  [
    "verify_email",
    "treg.people.email.verify",
    "Check an address delivers before anything is sent to it",
    "email",
  ],
  [
    "people_search",
    "treg.people.search",
    "Find people by name, title and school",
    "full_name or title, company_domain, keywords[]",
  ],
  [
    "web_search",
    "treg.google.serp.organic",
    "Google results, for faculty directories, program pages and scholarships",
    "q, country, limit",
  ],
  [
    "render_page",
    "litescrape.web.fetch.post",
    "A page that needs JavaScript to show its content, as text",
    'url, respond_with: "markdown"',
  ],
  [
    "scholar_search",
    "serper.google.serp.scholar",
    "Google Scholar results, for recent papers when OpenAlex is thin",
    "q",
  ],
  [
    "x_posts",
    "treg.x.search.posts",
    'Posts on X, for "looking for PhD students" announcements',
    "q",
  ],
  [
    "reddit_search",
    "tikhub.x.reddit-app-fetch-dynamic-search",
    "Reddit posts, for admissions results and lab reputations",
    'query, search_type: "post"',
  ],
  [
    "linkedin_jobs",
    "anyapi.linkedin.search.jobs",
    "LinkedIn job posts, for European PhD positions posted as jobs",
    "query, location, limit",
  ],
] as const;

/** Every tool that spends through treg: switched off with treg. */
export const TREG_TOOL_NAMES = new Set<string>(["treg", ...JOBS.map(([name]) => name)]);

const shape = {
  data: z.record(z.string(), z.unknown()).describe("The request's fields"),
  purpose: z.string().describe("One line shown to the applicant: what this lookup is for"),
  about: z
    .string()
    .optional()
    .describe("The sheet key of the professor this lookup is for, when it is for one"),
};

/** The named tools, built on the treg tool so they share its caps, approvals and ledger. */
export const tregJobs = (treg: HuntTool) =>
  JOBS.map(([name, endpoint, what, args]): HuntTool<typeof shape> => ({
    name,
    description: `${what}. Paid through treg (${endpoint}), about $${TREG_ENDPOINTS[endpoint]?.usd ?? 0} a call. data: {${args}}.`,
    shape,
    paid: true,
    price: () => TREG_ENDPOINTS[endpoint]?.usd ?? 0,
    run: (a, ctx) => treg.run({ ...a, endpoint }, ctx),
  }));
