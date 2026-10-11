// The one place getmyprof makes paid lookups. Every one goes through tregCall: it tags the call
// with its hunt, thread and feature (from context, never from the model), caps it at the budget
// left, and returns what it really cost under treg's call id for the spend ledger. The login is
// the user's own team key, or a key a team issued to them, pinned by treg to their customer id
// (treg-org.ts mints them). Account and team management lives in treg-org.ts.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { TagValue } from "@getmyprof/contracts";
import { z } from "zod";
import { homeDir } from "./db.ts";
import { asArray, asRecord, text } from "./sources.ts";

export const TREG_BASE = "https://treg.to";

/**
 * The vendor list: treg endpoints getmyprof may call, with method, usual price, the most one call
 * may cost (USD) and the arguments the agent sends (from treg's catalog, checked 2026-10-07).
 * Routed endpoints try providers in turn, so a call can cost more than the usual price; `max`
 * goes out as X-Treg-Route-Max-Cost, and treg refuses rather than charge more.
 */
export const TREG_ENDPOINTS: Record<
  string,
  {
    method: "GET" | "POST";
    usd: number;
    max: number;
    args: string;
    /** Fields the endpoint always needs, sent whatever the agent passes. */
    fixed?: Record<string, string>;
  }
> = {
  "treg.people.email.verify": { method: "POST", usd: 0, max: 0.014, args: "email" },
  "treg.people.search": {
    method: "POST",
    usd: 0,
    max: 0.05,
    args: "full_name or title, company_domain, keywords[], country, limit",
  },
  "apollo.people.search": {
    method: "POST",
    usd: 0,
    max: 0,
    args: "person_titles[], q_organization_domains_list[], person_locations[], per_page",
  },
  "getleadsio.people.enrich.from_linkedin": {
    method: "POST",
    usd: 0,
    max: 0.01,
    args: "items: [{linkedin_url}]",
  },
  // Free search and papers (99% and 100% measured success), so they come first; Google is the
  // paid fallback for when they find too little.
  "tinyfish.web.search": {
    method: "GET",
    usd: 0,
    max: 0,
    args: "query, location, page",
    fixed: { domain_type: "web" },
  },
  "tinyfish.web.search.publications": {
    method: "GET",
    usd: 0,
    max: 0,
    args: "query, pub_year_min, page",
    fixed: { domain_type: "research_paper" },
  },
  "tinyfish.web.fetch": {
    method: "POST",
    usd: 0,
    max: 0,
    args: 'urls[] (up to 10), format: "markdown", links',
  },
  // The member id LinkedIn's message box needs (outreach/linkedin.ts).
  "fetchinio.linkedin.user.profile": {
    method: "GET",
    usd: 0.0015,
    max: 0.0015,
    args: "profileUrlOrUrn (a profile URL)",
  },
  "litescrape.web.fetch.post": {
    method: "POST",
    usd: 0.00015,
    max: 0.00015,
    args: 'url, respond_with: "markdown" (renders JavaScript)',
  },
  "crawl4ai.web.scrape": {
    method: "POST",
    usd: 0.00015,
    max: 0.001,
    args: 'url, format: "md" (PDFs too)',
  },
  "anyapi.linkedin.search.jobs": {
    method: "POST",
    usd: 0.0005,
    max: 0.0005,
    args: "query, location, limit",
  },
  "treg.x.search.posts": { method: "POST", usd: 0.00075, max: 0.015, args: "q" },
  "anyapi.x.search.posts": { method: "POST", usd: 0.00075, max: 0.00075, args: "query, limit" },
  "anyapi.google.serp.organic": {
    method: "POST",
    usd: 0.0009,
    max: 0.0009,
    args: "query, gl, page",
  },
  "serper.google.serp.scholar": { method: "POST", usd: 0.001, max: 0.001, args: "q" },
  // One professor's Scholar profile (SerpApi's author engine); treg's schema wants a q it ignores.
  "serpapi.x.google-scholar": {
    method: "GET",
    usd: 0.015,
    max: 0.015,
    args: "author_id (the user= part of a scholar.google.com/citations link)",
    fixed: { engine: "google_scholar_author", sort: "pubdate", q: "profile" },
  },
  "anyapi.google.scholar": { method: "POST", usd: 0.001, max: 0.001, args: "query" },
  "tikhub.x.reddit-app-fetch-dynamic-search": {
    method: "GET",
    usd: 0.001,
    max: 0.001,
    args: 'query, search_type: "post"',
  },
  "millionverifier.people.email.verify": {
    method: "GET",
    usd: 0.0018,
    max: 0.0018,
    args: "email",
  },
  "bounceban.people.email.verify": { method: "GET", usd: 0.004, max: 0.004, args: "email" },
  "treg.people.email.find": {
    method: "POST",
    usd: 0.0048,
    max: 0.05,
    args: "full_name and domain, or linkedin_url",
  },
  "exa.web.answer": { method: "POST", usd: 0.005, max: 0.005, args: "query" },
  "exa.web.search.publications": {
    method: "POST",
    usd: 0.007,
    max: 0.007,
    args: 'query, category: "publication", numResults',
  },
  "exa.people.search": {
    method: "POST",
    usd: 0.007,
    max: 0.007,
    args: 'query, category: "people", numResults',
  },
  "treg.web.extract.structured": {
    method: "POST",
    usd: 0.01,
    max: 0.011,
    args: "url, instruction, schema (JSON Schema)",
  },
  "prospeo.people.email.find": {
    method: "POST",
    usd: 0.0245,
    max: 0.0245,
    args: "only_verified_email: true, enrich_mobile: false, only_verified_mobile: false, data: {full_name, company_website}",
  },
};

/**
 * The saved login: the key, and who treg said it is when it connected. `customer` is the
 * customer a team's key was issued to (typed by hand in logins saved before treg's pin carried it).
 */
export const TregLogin = z.object({
  token: z.string(),
  customer: TagValue.optional(),
  org: z.string().default(""),
  role: z.string().default("member"),
  issued: z.boolean().default(true),
});
export type TregLogin = z.input<typeof TregLogin>;

const loginPath = () => NodePath.join(homeDir(), "treg.json");

export function readTregLogin() {
  try {
    return TregLogin.parse(JSON.parse(NodeFS.readFileSync(loginPath(), "utf8")));
  } catch {
    return null;
  }
}

/** Saves the token readable by this user only. It never crosses the wire or enters a backup. */
export function saveTregLogin(login: TregLogin) {
  NodeFS.mkdirSync(NodePath.dirname(loginPath()), { recursive: true });
  NodeFS.writeFileSync(loginPath(), JSON.stringify(login), { mode: 0o600 });
  NodeFS.chmodSync(loginPath(), 0o600);
}

export const removeTregLogin = () => NodeFS.rmSync(loginPath(), { force: true });

export type TregRequest = {
  endpoint: string;
  data: Record<string, unknown>;
  /** The most this call may cost, in USD: the endpoint's max or the budget left, whichever is lower. */
  maxUsd: number;
  /** What the call is for. treg adds the customer an issued key is pinned to. */
  tags: { thread: string; feature: string; hunt?: string | undefined };
};

export type TregOutcome =
  | { ok: true; result: unknown; callId: string | null; costUsd: number }
  /** `stop`: no paid call can succeed now (a cap, a block, the account), so a loop run should end. */
  | { ok: false; reason: string; callId: string | null; costUsd: number; stop: boolean };

const usd = (n: number) => String(Number(n.toFixed(6)));

/** Why treg itself refused (X-Treg-Error: 1), in words safe to show the applicant and the model. */
function refusal(status: number, body: unknown, maxUsd: number, endpointMax: number) {
  const b = asRecord(body);
  const e = typeof b.error === "string" ? b : asRecord(b.detail);
  const code = typeof e.error === "string" ? e.error : "";
  const micro = (k: string) => Number(e[k] ?? 0) / 1e6;
  if (code === "route_max_cost")
    return maxUsd < endpointMax
      ? {
          reason: `This lookup could cost more than the $${usd(maxUsd)} left in the budget. Skipped; nothing was charged.`,
          stop: true,
        }
      : {
          reason:
            "This lookup would cost more than getmyprof allows for one call. Skipped; nothing was charged.",
          stop: false,
        };
  if (code === "tag_spend_cap_reached")
    return {
      reason: `This install's limit for paid lookups is used up ($${usd(micro("spent_micro"))} of $${usd(micro("cap_micro"))} this ${String(e.period ?? "day")}).`,
      stop: true,
    };
  if (code === "tag_blocked")
    return {
      reason: "Paid lookups are paused for this install by whoever issued its treg token.",
      stop: true,
    };
  if (status === 401 || status === 403)
    return { reason: "treg refused this install's token. Reconnect it in Settings.", stop: true };
  if (code === "insufficient_balance" || code === "platform_daily_cap_reached" || status === 402) {
    // The body carries the issuer's balance and top-up link: it stays in the server log only.
    console.error(`treg account problem: ${status} ${code}`);
    return {
      reason: "Paid lookups are unavailable right now. Continue with free sources.",
      stop: true,
    };
  }
  return { reason: `treg refused the call (${code || status}).`, stop: false };
}

/**
 * One treg call over HTTP. Retries a network error, a busy treg (503) or an in-flight duplicate
 * (409) with the same Idempotency-Key, so a retry is never paid for twice.
 */
export async function tregCall(
  req: TregRequest,
  login: TregLogin | null = readTregLogin(),
  fetchFn: typeof fetch = fetch,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<TregOutcome> {
  const spec = TREG_ENDPOINTS[req.endpoint];
  if (!spec)
    return {
      ok: false,
      reason: `${req.endpoint} is not an allowed endpoint.`,
      callId: null,
      costUsd: 0,
      stop: false,
    };
  if (!login)
    return {
      ok: false,
      reason: "treg isn't connected. Connect it in Settings.",
      callId: null,
      costUsd: 0,
      stop: true,
    };

  // customer_feature lets the team's Customers page split each customer's spend by feature.
  const tags = {
    customer: login.customer,
    ...req.tags,
    customer_feature: login.customer && `${login.customer}.${req.tags.feature}`,
  };
  const meta = Object.entries(tags)
    .filter(([, v]) => v && TagValue.safeParse(v).success)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const data = { ...req.data, ...spec.fixed };
  const query =
    spec.method === "GET"
      ? `?${new URLSearchParams(Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]))}`
      : "";
  const init: RequestInit = {
    method: spec.method,
    headers: {
      "X-Treg-Token": login.token,
      "X-Treg-Meta": meta,
      "X-Treg-Route-Max-Cost": usd(Math.max(0, req.maxUsd)),
      "Idempotency-Key": crypto.randomUUID(),
      ...(spec.method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(spec.method === "POST" ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(120_000),
  };

  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetchFn(`${TREG_BASE}/call/${req.endpoint}${query}`, init);
    } catch (error) {
      if (attempt < 2) {
        await wait(1000 * (attempt + 1));
        continue;
      }
      return {
        ok: false,
        reason: `treg is unreachable: ${String(error).slice(0, 120)}`,
        callId: null,
        costUsd: 0,
        stop: false,
      };
    }
    const callId = r.headers.get("x-treg-call-id");
    // A replay of an attempt whose answer was lost reports 0 and carries the first charge apart.
    const micro = r.headers.get("x-treg-original-cost-micro") ?? r.headers.get("x-treg-cost-micro");
    const costUsd = Number(micro ?? 0) / 1e6;
    const raw = await r.text();
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      // Not JSON: keep the text.
    }
    if ((r.status === 503 || r.status === 409) && attempt < 2) {
      const after = Number(r.headers.get("retry-after") ?? 2);
      await wait(Math.min(10, Number.isFinite(after) ? after : 2) * 1000);
      continue;
    }
    if (r.ok) return { ok: true, result: body, callId, costUsd };
    if (r.headers.get("x-treg-error") === "1")
      return { ok: false, callId, costUsd, ...refusal(r.status, body, req.maxUsd, spec.max) };
    // The provider's own error, relayed verbatim. A failed upstream call is normally free.
    return {
      ok: false,
      reason: `The provider answered ${r.status}: ${raw.slice(0, 300)}`,
      callId,
      costUsd,
      stop: false,
    };
  }
}

const UsageByTag = z.object({
  rows: z.array(z.object({ value: z.string(), charged_micro: z.number(), calls: z.number() })),
  attributed_micro: z.number(),
  unattributed_micro: z.number(),
  total_micro: z.number(),
});

/**
 * Invoice lines from treg's `usage/by-tag?key=customer` report (money comes from treg's ledger,
 * never the call log). Refuses a report that doesn't reconcile, so a bad invoice never ships.
 */
export function invoiceLines(report: unknown) {
  const r = UsageByTag.parse(report);
  if (r.attributed_micro + r.unattributed_micro !== r.total_micro)
    throw new Error(
      `treg's ledger doesn't reconcile: ${r.attributed_micro} + ${r.unattributed_micro} != ${r.total_micro}`,
    );
  return {
    lines: r.rows.map((x) => ({ customer: x.value, calls: x.calls, usd: x.charged_micro / 1e6 })),
    unattributedUsd: r.unattributed_micro / 1e6,
  };
}

/** The first list of hits or pages in a treg result, however deep its provider put it. */
function hitsIn(v: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 4 || !v || typeof v !== "object") return null;
  if (Array.isArray(v)) {
    const rows = v.map(asRecord);
    return rows.length && rows.every((r) => "url" in r || "link" in r) ? rows : null;
  }
  for (const x of Object.values(v)) {
    const found = hitsIn(x, depth + 1);
    if (found) return found;
  }
  return null;
}

const cut = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)} …(cut at ${n} of ${s.length} characters)` : s;

/**
 * A treg result as the agent reads it: one line per search hit (with a paper's authors, year,
 * citations and PDF), each fetched page's own text with its share of the limit, failures by URL,
 * and anything else as JSON. Every cut says so.
 */
export function tregText(result: unknown, limit = 16_000) {
  if (asRecord(result).author && asRecord(result).articles) return scholarText(asRecord(result));
  const rows = hitsIn(result);
  if (!rows) return cut(JSON.stringify(result) ?? "", limit);
  const perPage = Math.min(6000, Math.floor(limit / rows.length));
  const lines = rows.map((r) => {
    const url = text(r.final_url || r.url || r.link);
    const page = text(r.text || r.markdown || r.content);
    if (page) return `## ${text(r.title)} (${url})\n${cut(page, perPage)}`;
    const paper = [
      asArray(r.authors).map(text).join(", "),
      text(r.year),
      text(r.venue),
      r.cited_by_count == null ? "" : `cited ${text(r.cited_by_count)}`,
      text(r.pdf_url),
    ];
    return cut(
      [text(r.title), url, text(r.snippet || r.description), ...paper].filter(Boolean).join(" | "),
      600,
    );
  });
  const failed = asArray(asRecord(result).errors).map(
    (e) => `failed: ${text(asRecord(e).url)} (${text(asRecord(e).error || asRecord(e).message)})`,
  );
  // Each page and hit is cut on its own, so the whole needs no second cut.
  return [...lines, ...failed].join("\n");
}

/** A Google Scholar profile in a few lines; SerpApi's answer runs to 25 KB. Paper links are left
 * out: they are Scholar pages, which refuse anything but a browser. */
function scholarText(r: Record<string, unknown>) {
  const a = asRecord(r.author);
  const table = asArray(asRecord(r.cited_by).table).map(asRecord);
  const stat = (k: string) => text(asRecord(table.find((t) => k in t)?.[k]).all) || "?";
  return [
    [text(a.name), text(a.affiliations), text(a.email), text(a.website)]
      .filter(Boolean)
      .join(" | "),
    `Interests: ${asArray(a.interests)
      .map((i) => text(asRecord(i).title))
      .join(", ")}`,
    `Cited ${stat("citations")} | h-index ${stat("h_index")} | i10 ${stat("i10_index")}`,
    `Co-authors: ${asArray(r.co_authors)
      .slice(0, 10)
      .map(asRecord)
      .map((c) => `${text(c.name)} (${text(c.affiliations)})`)
      .join("; ")}`,
    "Newest works:",
    ...asArray(r.articles)
      .slice(0, 10)
      .map(asRecord)
      .map((w) => `- ${text(w.title)} (${text(w.year)})`),
  ].join("\n");
}

/**
 * A page's text through treg's free fetch, which renders JavaScript and reads pages this server
 * can't load (some departments' TLS chains). Null without a treg login or when it fails too. Free,
 * so it runs even with paid lookups off.
 */
export async function renderedPage(url: string, login = readTregLogin()) {
  if (!login) return null;
  const r = await tregCall(
    {
      endpoint: "tinyfish.web.fetch",
      data: { urls: [url], format: "markdown" },
      maxUsd: 0,
      // Free and not tied to one thread, so nothing to bill or tag beyond what it was for.
      tags: { thread: "", feature: "page" },
    },
    login,
  );
  return r.ok ? text(asRecord(asArray(asRecord(r.result).results)[0]).text) || null : null;
}
