// The one place gradcode makes paid lookups. Every one goes through tregCall: it tags the call
// with its hunt, thread and feature (from context, never from the model), caps it at the budget
// left, and returns what it really cost under treg's call id for the spend ledger. The login is
// the user's own team key, or a key a team issued to them, pinned by treg to their customer id
// (treg-org.ts mints them). Account and team management lives in treg-org.ts.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { TagValue } from "@gradcode/contracts";
import { z } from "zod";
import { homeDir } from "./db.ts";
import { asRecord } from "./sources.ts";

export const TREG_BASE = "https://treg.to";

/**
 * The vendor list: treg endpoints gradcode may call, with method, usual price, the most one call
 * may cost (USD) and the arguments the agent sends (from treg's catalog, checked 2026-10-07).
 * Routed endpoints try providers in turn, so a call can cost more than the usual price; `max`
 * goes out as X-Treg-Route-Max-Cost, and treg refuses rather than charge more.
 */
export const TREG_ENDPOINTS: Record<
  string,
  { method: "GET" | "POST"; usd: number; max: number; args: string }
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
  "tinyfish.web.search": {
    method: "GET",
    usd: 0,
    max: 0,
    args: 'query, domain_type: "web", location',
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
  "treg.google.serp.organic": {
    method: "POST",
    usd: 0.0009,
    max: 0.015,
    args: "q, country, limit",
  },
  "serper.google.serp.scholar": { method: "POST", usd: 0.001, max: 0.001, args: "q" },
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
            "This lookup would cost more than gradcode allows for one call. Skipped; nothing was charged.",
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
  const query =
    spec.method === "GET"
      ? `?${new URLSearchParams(Object.entries(req.data).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]))}`
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
    ...(spec.method === "POST" ? { body: JSON.stringify(req.data) } : {}),
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
