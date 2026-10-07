// The one place gradcode talks to treg. Every paid lookup goes through tregCall: it tags the call
// with this install's customer (from the saved login, never from the model), caps it at the
// budget left, and returns what it really cost under treg's call id for the spend ledger.
// The login is a token pinned to customer=<id>, minted by scripts/treg-admin.ts.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { TagValue, TregConnect } from "@gradcode/contracts";
import { z } from "zod";
import { homeDir } from "./db.ts";
import { asRecord } from "./sources.ts";

export const TREG_BASE = "https://treg.to";

/**
 * treg endpoints gradcode may call: method, usual price and the most one call may cost (USD).
 * Routed endpoints try providers in turn, so a call can cost more than the usual price; `max`
 * goes out as X-Treg-Route-Max-Cost, and treg refuses rather than charge more.
 */
export const TREG_ENDPOINTS: Record<string, { method: "GET" | "POST"; usd: number; max: number }> =
  {
    "treg.people.email.verify": { method: "POST", usd: 0, max: 0.014 },
    "treg.people.search": { method: "POST", usd: 0, max: 0.05 },
    "apollo.people.search": { method: "POST", usd: 0, max: 0 },
    "getleadsio.people.enrich.from_linkedin": { method: "POST", usd: 0, max: 0.01 },
    "tinyfish.web.search": { method: "GET", usd: 0, max: 0 },
    "litescrape.web.fetch.post": { method: "POST", usd: 0.00015, max: 0.00015 },
    "anyapi.linkedin.search.jobs": { method: "POST", usd: 0.0005, max: 0.0005 },
    "treg.x.search.posts": { method: "POST", usd: 0.00075, max: 0.015 },
    "anyapi.x.search.posts": { method: "POST", usd: 0.00075, max: 0.00075 },
    "treg.google.serp.organic": { method: "POST", usd: 0.0009, max: 0.015 },
    "serper.google.serp.scholar": { method: "POST", usd: 0.001, max: 0.001 },
    "anyapi.google.scholar": { method: "POST", usd: 0.001, max: 0.001 },
    "tikhub.x.reddit-app-fetch-dynamic-search": { method: "GET", usd: 0.001, max: 0.001 },
    "millionverifier.people.email.verify": { method: "GET", usd: 0.0018, max: 0.0018 },
    "bounceban.people.email.verify": { method: "GET", usd: 0.004, max: 0.004 },
    "treg.people.email.find": { method: "POST", usd: 0.0048, max: 0.05 },
    "exa.web.answer": { method: "POST", usd: 0.005, max: 0.005 },
    "exa.web.search.publications": { method: "POST", usd: 0.007, max: 0.007 },
    "exa.people.search": { method: "POST", usd: 0.007, max: 0.007 },
    "treg.web.extract.structured": { method: "POST", usd: 0.01, max: 0.011 },
    "prospeo.people.email.find": { method: "POST", usd: 0.0245, max: 0.0245 },
  };

export type TregLogin = TregConnect;

const loginPath = () => NodePath.join(homeDir(), "treg.json");

export function readTregLogin(): TregLogin | null {
  try {
    return TregConnect.parse(JSON.parse(NodeFS.readFileSync(loginPath(), "utf8")));
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

/** Whether treg accepts this token: a free, authenticated read that reaches no provider. */
export async function checkTregToken(token: string, fetchFn: typeof fetch = fetch) {
  const r = await fetchFn(`${TREG_BASE}/tools`, { headers: { "X-Treg-Token": token } });
  if (r.status === 401 || r.status === 403) throw new Error("treg refused this token");
  if (!r.ok) throw new Error(`treg answered ${r.status}; try again`);
}

export type TregRequest = {
  endpoint: string;
  data: Record<string, unknown>;
  /** The most this call may cost, in USD: the endpoint's max or the budget left, whichever is lower. */
  maxUsd: number;
  /** What the call is for. The customer is added from the login. */
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

  const tags = { customer: login.customer, ...req.tags };
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
    const costUsd = Number(r.headers.get("x-treg-cost-micro") ?? 0) / 1e6;
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
