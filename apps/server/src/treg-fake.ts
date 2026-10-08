// A treg team in memory for the scripted stack (GETMYPROF_AGENT=fake): connecting, the Customers
// page and invoices work end to end without reaching treg or spending anything. Signing in makes
// you the team's owner; any pasted key is one the team issued. treg-org.ts talks to it through
// the fetch it would use for treg.to, so every path it takes is the real one.
import { z } from "zod";

/** The key the scripted sign-in hands back: the owner of the team "scripted". */
export const FAKE_OWNER_KEY = "scripted-owner";

type Ledger = { month: Record<string, number>; calls: number; today: number };

export function fakeTregTeam(): typeof fetch {
  let balance = 18.4e6;
  let defaultCap: number | null = 1e6;
  let n = 3;
  const agents = [
    { user_id: 1, customer: "maya", created_at: "2026-10-02T09:00:00Z", token: "trg_fake_maya" },
    { user_id: 2, customer: "rafi", created_at: "2026-09-29T09:00:00Z", token: "trg_fake_rafi" },
    { user_id: 3, customer: "tan", created_at: "2026-09-20T09:00:00Z", token: "trg_fake_tan" },
  ];
  const budgets = new Map([
    ["maya", { cap: 5e6 as number | null, blocked: false }],
    ["rafi", { cap: 5e6 as number | null, blocked: false }],
    ["tan", { cap: null as number | null, blocked: true }],
  ]);
  // Micro-dollars by feature this month. Spend stays here after a customer's key is removed.
  const ledger = new Map<string, Ledger>([
    [
      "maya",
      { month: { "row-email": 1.62e6, hunt: 0.3e6, loop: 0.18e6 }, calls: 164, today: 0.4e6 },
    ],
    ["rafi", { month: { "row-email": 4.2e6, hunt: 0.8e6 }, calls: 402, today: 5e6 }],
  ]);
  const ownUse = 0.88e6;
  const auto = { enabled: false, threshold_usd: 5, amount_usd: 20, monthly_cap_usd: 100 };
  let card = false;

  const total = (l: Ledger) => Object.values(l.month).reduce((a, b) => a + b, 0);
  const report = (rows: { value: string; charged_micro: number; calls: number }[]) => {
    const attributed = rows.reduce((a, r) => a + r.charged_micro, 0);
    return {
      rows,
      attributed_micro: attributed,
      unattributed_micro: ownUse,
      total_micro: attributed + ownUse,
    };
  };

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    const body = bodyOf(init?.body);
    const token = new Headers(init?.headers).get("X-Treg-Token") ?? "";
    const json = (b: unknown) => Response.json(b);

    if (route === "GET /auth/me") {
      const agent = agents.find((a) => a.token === token);
      return json(
        token === FAKE_OWNER_KEY
          ? { org_id: 1, org: "scripted", role: "owner", email: "you@example.com" }
          : {
              org_id: 1,
              org: "scripted",
              role: "member",
              email: `agent-scripted-${agent ? `getmyprof-${agent.customer}` : "key"}@agents.treg.local`,
            },
      );
    }
    if (route === "GET /tools") return json([]);
    if (route === "GET /orgs/1/agents")
      return json(
        agents.map((a) => ({
          user_id: a.user_id,
          name: `getmyprof-${a.customer}`,
          created_at: a.created_at,
          pinned_tags: { customer: a.customer },
        })),
      );
    if (route === "POST /orgs/1/agents") {
      const customer = String(body.name).replace(/^getmyprof-/, "");
      const key = `trg_fake_${customer}_${++n}`;
      const had = agents.find((a) => a.customer === customer);
      // Minting again under the same name is a new key: the old one stops working.
      if (had) had.token = key;
      else agents.push({ user_id: n, customer, created_at: new Date().toISOString(), token: key });
      return json({ token: key });
    }
    const gone = /^DELETE \/orgs\/1\/agents\/(\d+)$/.exec(route);
    if (gone) {
      agents.splice(
        agents.findIndex((a) => a.user_id === Number(gone[1])),
        1,
      );
      return json({});
    }
    if (route === "GET /orgs/1/budgets")
      return json([
        { val: null, is_default: true, daily_cap_micro: defaultCap, status: "active" },
        ...[...budgets].map(([val, b]) => ({
          val,
          is_default: false,
          daily_cap_micro: b.cap,
          status: b.blocked ? "blocked" : "active",
        })),
      ]);
    if (route === "PUT /orgs/1/budgets/customer") {
      defaultCap = Number(body.daily_cap_micro);
      return json({});
    }
    const own = /^PUT \/orgs\/1\/budgets\/customer\/(.+)$/.exec(route);
    if (own?.[1]) {
      const b = budgets.get(own[1]) ?? { cap: null, blocked: false };
      if ("daily_cap_micro" in body)
        b.cap = body.daily_cap_micro == null ? null : Number(body.daily_cap_micro);
      if ("status" in body) b.blocked = body.status === "blocked";
      budgets.set(own[1], b);
      return json({});
    }
    if (route === "GET /orgs/1/usage/by-tag") {
      const today = url.searchParams.get("days") === "1";
      const all = [...ledger];
      if (url.searchParams.get("key") === "customer_feature")
        return json(
          report(
            all.flatMap(([c, l]) =>
              Object.entries(l.month).map(([f, micro]) => ({
                value: `${c}.${f}`,
                charged_micro: today ? Math.round((micro * l.today) / total(l)) : micro,
                calls: Math.round((l.calls * micro) / total(l)),
              })),
            ),
          ),
        );
      return json(
        report(
          all.map(([c, l]) => ({
            value: c,
            charged_micro: today ? l.today : total(l),
            calls: today ? Math.round((l.calls * l.today) / total(l)) : l.calls,
          })),
        ),
      );
    }
    if (route === "GET /orgs/1/balance") return json({ balance_micro: balance });
    if (route === "GET /billing")
      return json({
        card_on_file: card,
        topup: {
          min_usd: 10,
          presets: [10, 50, 100, 200],
          bonus_tiers: { 50: 5, 100: 10, 200: 15 },
        },
        autotopup: { ...auto, disabled_reason: null },
      });
    if (route === "POST /billing/autotopup") {
      auto.enabled = body.enabled === true;
      for (const k of ["threshold_usd", "amount_usd", "monthly_cap_usd"] as const)
        if (typeof body[k] === "number") auto[k] = body[k];
      // The first time, treg's card page; here the card is saved at once.
      const setup = auto.enabled && !card;
      card ||= auto.enabled;
      return json({ setup_url: setup ? "about:blank" : null });
    }
    if (route === "POST /billing/topup") {
      // No checkout to pay at: the money lands at once.
      const dollars = Number(body.amount_usd);
      balance += (dollars + ({ 50: 5, 100: 10, 200: 15 }[dollars] ?? 0)) * 1e6;
      return json({ url: "about:blank" });
    }
    return Response.json({ detail: `no ${route}` }, { status: 404 });
  }) as typeof fetch;
}

/** A request body as a plain object; empty when there is none. */
const bodyOf = (body: RequestInit["body"]) =>
  typeof body === "string" ? z.record(z.string(), z.unknown()).parse(JSON.parse(body)) : {};
