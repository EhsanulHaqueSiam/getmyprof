// The treg account behind this install's key, and for a team's owner or admin its customers:
// mint a key pinned to one customer, cap, block or remove them, top up, and invoice from treg's
// ledger. Settings (rpc.ts) and scripts/treg-admin.ts both call these. Signing in reuses
// `treg login`'s browser handshake, so a user connects their own account without copying a key.
import { TagValue } from "@gradcode/contracts";
import { z } from "zod";
import { invoiceLines, TREG_BASE } from "./treg.ts";

type Fetch = typeof fetch;

/** One call to treg's API as `token`; throws with treg's own words. */
export async function tregApi(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  fetchFn: Fetch = fetch,
): Promise<unknown> {
  const r = await fetchFn(`${TREG_BASE}${path}`, {
    method,
    headers: { "X-Treg-Token": token, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (!r.ok) {
    const detail = z.object({ detail: z.string() }).safeParse(safeJson(text));
    throw new Error(`treg: ${detail.success ? detail.data.detail : `${r.status} on ${path}`}`);
  }
  return safeJson(text);
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const Me = z.object({ org_id: z.number(), org: z.string(), role: z.string(), email: z.string() });

/** Who a key is: its team, its role there, and whether it was issued to someone (an agent). */
export async function whoIs(token: string, fetchFn: Fetch = fetch) {
  const me = Me.parse(await tregApi(token, "GET", "/auth/me", undefined, fetchFn));
  return {
    orgId: me.org_id,
    org: me.org,
    role: me.role,
    // Keys minted for a machine, like a customer's, sign in as <name>@agents.treg.local.
    issued: me.email.endsWith("@agents.treg.local"),
  };
}

/** Owners and admins manage customers and see the balance; a customer's key never does. */
export const canManage = (role: string) => role === "owner" || role === "admin";

const Start = z.object({ login_id: z.string(), code: z.string() });

/** Starts treg's browser sign-in: the page to open, and the code it shows to match. */
export async function startLogin(fetchFn: Fetch = fetch) {
  const r = await fetchFn(`${TREG_BASE}/auth/cli/start`, { method: "POST" });
  if (!r.ok) throw new Error(`treg didn't start a sign-in (${r.status}); try again`);
  const s = Start.parse(await r.json());
  return {
    id: s.login_id,
    code: s.code,
    url: `${TREG_BASE}/login?cli=${s.login_id}#code=${s.code}`,
  };
}

const Poll = z.object({ token: z.string().optional(), active_org: z.string().optional() });

/**
 * The key a sign-in produced, or null while the user hasn't approved it yet. An identity key is
 * swapped for the chosen team's own key, which works anywhere without naming the team.
 */
export async function pollLogin(id: string, fetchFn: Fetch = fetch) {
  const r = await fetchFn(`${TREG_BASE}/auth/cli/poll?login_id=${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const p = Poll.parse(await r.json());
  if (!p.token) return null;
  if (!p.active_org) return p.token;
  const team = await fetchFn(`${TREG_BASE}/auth/cli-token`, {
    headers: { "X-Treg-Token": p.token, "X-Treg-Org": p.active_org },
  });
  const key = z.object({ token: z.string() }).safeParse(await team.json());
  return team.ok && key.success ? key.data.token : p.token;
}

const Agent = z.object({
  user_id: z.number(),
  name: z.string(),
  created_at: z.string(),
  pinned_tags: z.record(z.string(), z.unknown()).nullish(),
});
const Budget = z.object({
  val: z.string().nullish(),
  is_default: z.boolean(),
  daily_cap_micro: z.number().nullish(),
  status: z.string(),
});
const ByTag = z.object({
  rows: z.array(z.object({ value: z.string(), charged_micro: z.number(), calls: z.number() })),
  unattributed_micro: z.number(),
});
const Balance = z.object({ balance_micro: z.number() });

const usd = (micro: number | null | undefined) => (micro == null ? null : micro / 1e6);
const micro = (dollars: number) => Math.round(dollars * 1e6);
const agentName = (customer: string) => `gradcode-${TagValue.parse(customer)}`;

/**
 * The team's balance and every customer with a key: what they spent this month and today, their
 * daily limit (their own or the team default) and whether they are blocked. `ownUseUsd` is spend
 * that named no customer: the team's own keys.
 */
export async function customers(token: string, fetchFn: Fetch = fetch) {
  const { orgId } = await whoIs(token, fetchFn);
  const org = `/orgs/${orgId}`;
  const get = (path: string) => tregApi(token, "GET", `${org}${path}`, undefined, fetchFn);
  // by-tag counts whole UTC days back from today, so the day of the month is this month so far.
  const [agents, budgets, month, today, wallet] = await Promise.all([
    get("/agents").then(z.array(Agent).parse),
    get("/budgets").then(z.array(Budget).parse),
    get(`/usage/by-tag?key=customer&days=${new Date().getUTCDate()}`).then(ByTag.parse),
    get("/usage/by-tag?key=customer&days=1").then(ByTag.parse),
    get("/balance?limit=0").then(Balance.parse),
  ]);
  const fallback = budgets.find((b) => b.is_default);
  const list = agents.flatMap((a) => {
    const id = a.pinned_tags?.customer;
    if (typeof id !== "string") return [];
    const own = budgets.find((b) => !b.is_default && b.val === id);
    const spent = month.rows.find((r) => r.value === id);
    const cap = own?.daily_cap_micro ?? fallback?.daily_cap_micro;
    const todayMicro = today.rows.find((r) => r.value === id)?.charged_micro ?? 0;
    return [
      {
        id,
        since: a.created_at,
        monthUsd: usd(spent?.charged_micro ?? 0) ?? 0,
        calls: spent?.calls ?? 0,
        todayUsd: usd(todayMicro) ?? 0,
        dailyUsd: usd(cap),
        ownLimit: own?.daily_cap_micro != null,
        status:
          own?.status === "blocked"
            ? ("blocked" as const)
            : cap != null && todayMicro >= cap
              ? ("at-limit" as const)
              : ("active" as const),
      },
    ];
  });
  return {
    balanceUsd: usd(wallet.balance_micro) ?? 0,
    defaultDailyUsd: usd(fallback?.daily_cap_micro),
    billedUsd: list.reduce((n, c) => n + c.monthUsd, 0),
    ownUseUsd: usd(month.unattributed_micro) ?? 0,
    customers: list,
  };
}

/**
 * Mints a key pinned to one customer and returns it; treg shows it only this once. It gets every
 * tool, since treg's tool list can't name catalog endpoints, so it is refused in a team with
 * tools of its own: anything the team connected (an X or Google account) would be theirs too.
 */
export async function addCustomer(
  token: string,
  customer: string,
  dailyUsd: number | null,
  fetchFn: Fetch = fetch,
) {
  const { orgId } = await whoIs(token, fetchFn);
  const own = z
    .array(z.object({ name: z.string() }))
    .parse(await tregApi(token, "GET", "/tools", undefined, fetchFn));
  if (own.length)
    throw new Error(
      `This treg team has its own tools (${own.map((t) => t.name).join(", ")}), and every customer key would reach them. Use a team with none.`,
    );
  const agent = await tregApi(
    token,
    "POST",
    `/orgs/${orgId}/agents`,
    {
      name: agentName(customer),
      role: "member",
      daily_call_cap: -1,
      tool_access: null,
      local_run_enabled: false,
      pinned_tags: { customer },
    },
    fetchFn,
  );
  if (dailyUsd !== null) await setCustomer(token, customer, { dailyUsd }, fetchFn);
  return z.object({ token: z.string() }).parse(agent).token;
}

/** A new key for a customer; their old one stops working at once. Limits stay. */
export async function newKey(token: string, customer: string, fetchFn: Fetch = fetch) {
  const { orgId } = await whoIs(token, fetchFn);
  const agent = await tregApi(
    token,
    "POST",
    `/orgs/${orgId}/agents`,
    { name: agentName(customer) },
    fetchFn,
  );
  return z.object({ token: z.string() }).parse(agent).token;
}

/** Changes a customer's daily limit (null: the team default) or blocks them. Unsent fields stay. */
export async function setCustomer(
  token: string,
  customer: string,
  patch: { dailyUsd?: number | null | undefined; blocked?: boolean | undefined },
  fetchFn: Fetch = fetch,
) {
  const { orgId } = await whoIs(token, fetchFn);
  await tregApi(
    token,
    "PUT",
    `/orgs/${orgId}/budgets/customer/${TagValue.parse(customer)}`,
    {
      ...(patch.dailyUsd === undefined
        ? {}
        : { daily_cap_micro: patch.dailyUsd === null ? null : micro(patch.dailyUsd) }),
      ...(patch.blocked === undefined ? {} : { status: patch.blocked ? "blocked" : "active" }),
    },
    fetchFn,
  );
}

/** The daily limit for every customer without their own. */
export async function setDefaultLimit(token: string, dailyUsd: number, fetchFn: Fetch = fetch) {
  const { orgId } = await whoIs(token, fetchFn);
  await tregApi(
    token,
    "PUT",
    `/orgs/${orgId}/budgets/customer`,
    { daily_cap_micro: micro(dailyUsd) },
    fetchFn,
  );
}

/** Revokes a customer's key. What they spent stays in the ledger and on the invoice. */
export async function removeCustomer(token: string, customer: string, fetchFn: Fetch = fetch) {
  const { orgId } = await whoIs(token, fetchFn);
  const agents = z
    .array(Agent)
    .parse(await tregApi(token, "GET", `/orgs/${orgId}/agents`, undefined, fetchFn));
  const agent = agents.find((a) => a.name === agentName(customer));
  if (!agent) throw new Error(`No key for ${customer}.`);
  await tregApi(token, "DELETE", `/orgs/${orgId}/agents/${agent.user_id}`, undefined, fetchFn);
}

/** Invoice lines for the last `days` days, refused if treg's ledger doesn't add up. */
export async function invoice(token: string, days: number, fetchFn: Fetch = fetch) {
  const { orgId } = await whoIs(token, fetchFn);
  return invoiceLines(
    await tregApi(
      token,
      "GET",
      `/orgs/${orgId}/usage/by-tag?key=customer&days=${days}`,
      undefined,
      fetchFn,
    ),
  );
}

/** The team's balance in USD. */
export async function balance(token: string, fetchFn: Fetch = fetch) {
  const { orgId } = await whoIs(token, fetchFn);
  const b = Balance.parse(
    await tregApi(token, "GET", `/orgs/${orgId}/balance?limit=0`, undefined, fetchFn),
  );
  return b.balance_micro / 1e6;
}

/** A Stripe checkout page that adds `dollars` to the team's balance once paid. */
export async function topUp(token: string, dollars: number, fetchFn: Fetch = fetch) {
  const r = z
    .object({ url: z.string().optional(), checkout_url: z.string().optional() })
    .parse(await tregApi(token, "POST", "/billing/topup", { amount_usd: dollars }, fetchFn));
  const url = r.url ?? r.checkout_url;
  if (!url) throw new Error("treg didn't return a checkout page.");
  return url;
}
