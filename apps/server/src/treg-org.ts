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

/**
 * Who a key is: its team, its role there, whether it was issued to someone (an agent), and for a
 * key minted here for a customer, which one.
 */
export async function whoIs(token: string, fetchFn: Fetch = fetch) {
  const me = Me.parse(await tregApi(token, "GET", "/auth/me", undefined, fetchFn));
  // Keys minted for a machine sign in as agent-<team>-<name>@agents.treg.local; a customer's
  // name is gradcode-<customer> (agentName).
  const issued = me.email.endsWith("@agents.treg.local");
  const local = me.email.split("@")[0] ?? "";
  const prefix = `agent-${me.org}-gradcode-`;
  const customer = TagValue.safeParse(local.slice(prefix.length));
  return {
    orgId: me.org_id,
    org: me.org,
    role: me.role,
    issued,
    customer: issued && local.startsWith(prefix) && customer.success ? customer.data : undefined,
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
  const days = new Date().getUTCDate();
  const [agents, budgets, month, today, wallet, spentOn, pay] = await Promise.all([
    get("/agents").then(z.array(Agent).parse),
    get("/budgets").then(z.array(Budget).parse),
    get(`/usage/by-tag?key=customer&days=${days}`).then(ByTag.parse),
    get("/usage/by-tag?key=customer&days=1").then(ByTag.parse),
    get("/balance?limit=0").then(Balance.parse),
    get(`/usage/by-tag?key=customer_feature&days=${days}`).then(ByTag.parse),
    // A deployment without top-ups has no billing to show; the rest still works.
    billing(token, fetchFn).catch(() => null),
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
        // tregCall tags each call customer_feature=<customer>.<feature>; features have no dot.
        byFeature: spentOn.rows
          .filter((r) => r.value.slice(0, r.value.lastIndexOf(".")) === id)
          .map((r) => ({
            feature: r.value.slice(r.value.lastIndexOf(".") + 1),
            usd: r.charged_micro / 1e6,
          }))
          .toSorted((x, y) => y.usd - x.usd),
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
    billing: pay,
  };
}

const BillingState = z.object({
  card_on_file: z.boolean(),
  topup: z.object({
    min_usd: z.number(),
    presets: z.array(z.number()),
    bonus_tiers: z.record(z.string(), z.number()),
  }),
  autotopup: z.object({
    enabled: z.boolean(),
    threshold_usd: z.number(),
    amount_usd: z.number(),
    monthly_cap_usd: z.number(),
    disabled_reason: z.string().nullish(),
  }),
});

/**
 * How the team pays: the top-up amounts treg offers (with its bonus on bigger ones), and its
 * auto top-up, which adds money whenever the balance runs low so customers' lookups never stop.
 */
export async function billing(token: string, fetchFn: Fetch = fetch) {
  const b = BillingState.parse(await tregApi(token, "GET", "/billing", undefined, fetchFn));
  return {
    minTopUpUsd: b.topup.min_usd,
    topUps: b.topup.presets.map((dollars) => ({
      usd: dollars,
      bonusUsd: b.topup.bonus_tiers[String(dollars)] ?? 0,
    })),
    auto: {
      on: b.autotopup.enabled,
      underUsd: b.autotopup.threshold_usd,
      addUsd: b.autotopup.amount_usd,
      monthCapUsd: b.autotopup.monthly_cap_usd,
      cardOnFile: b.card_on_file,
      problem: b.autotopup.disabled_reason ?? "",
    },
  };
}

/**
 * Turns auto top-up on (recording the owner's consent to the amounts they saw) or off. On with
 * no card saved yet: treg's card page, where finishing arms it; otherwise "".
 */
export async function setAutoTopUp(
  token: string,
  p: { on: boolean; underUsd: number; addUsd: number; monthCapUsd: number },
  fetchFn: Fetch = fetch,
) {
  const r = z.object({ setup_url: z.string().nullish() }).parse(
    await tregApi(
      token,
      "POST",
      "/billing/autotopup",
      {
        enabled: p.on,
        threshold_usd: p.underUsd,
        amount_usd: p.addUsd,
        monthly_cap_usd: p.monthCapUsd,
        consent: p.on,
        setup_url: true,
      },
      fetchFn,
    ),
  );
  return r.setup_url ?? "";
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
  // Minting under a name that exists replaces that key: refuse, so a typo never cuts someone off.
  // "Maya" and "maya" read as one person, so case doesn't make a new one.
  const agents = z
    .array(Agent)
    .parse(await tregApi(token, "GET", `/orgs/${orgId}/agents`, undefined, fetchFn));
  if (agents.some((a) => a.name.toLowerCase() === agentName(customer).toLowerCase()))
    throw new Error(`${customer} already has a key. Open them and use New key to replace it.`);
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
