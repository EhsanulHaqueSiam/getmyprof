import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { addCustomer, customers, pollLogin } from "./treg-org.ts";

/** A treg that answers by method and path, and records what was sent. */
function fakeTreg(routes: Record<string, unknown>) {
  const sent: { route: string; body: unknown; headers: Headers }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const route = `${init?.method ?? "GET"} ${u.pathname}${u.search}`;
    sent.push({
      route,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
    });
    return route in routes
      ? Response.json(routes[route])
      : Response.json({ detail: `no ${route}` }, { status: 404 });
  };
  return { f: f as typeof fetch, sent };
}

const me = { org_id: 7, org: "gradcode", role: "owner", email: "siam@example.com" };
const usage = (rows: object[], unattributed = 0) => ({ rows, unattributed_micro: unattributed });

describe("a team's customers", () => {
  afterEach(() => vi.useRealTimers());

  it("shows each one's spend and limit, their own or the default, and who is blocked or at it", async () => {
    // This month so far is 15 days of usage.
    vi.useFakeTimers({ now: new Date("2026-10-15T12:00:00Z"), toFake: ["Date"] });
    const { f } = fakeTreg({
      "GET /auth/me": me,
      "GET /orgs/7/agents": [
        {
          user_id: 1,
          name: "gradcode-maya",
          created_at: "2026-10-02",
          pinned_tags: { customer: "maya" },
        },
        {
          user_id: 2,
          name: "gradcode-rafi",
          created_at: "2026-09-29",
          pinned_tags: { customer: "rafi" },
        },
        {
          user_id: 3,
          name: "gradcode-tan",
          created_at: "2026-09-20",
          pinned_tags: { customer: "tan" },
        },
        { user_id: 4, name: "ci-bot", created_at: "2026-09-01", pinned_tags: null },
      ],
      "GET /orgs/7/budgets": [
        { val: null, is_default: true, daily_cap_micro: 1e6, status: "active" },
        { val: "rafi", is_default: false, daily_cap_micro: 5e6, status: "active" },
        { val: "tan", is_default: false, daily_cap_micro: null, status: "blocked" },
      ],
      "GET /orgs/7/usage/by-tag?key=customer&days=15": usage(
        [
          { value: "maya", charged_micro: 2.1e6, calls: 164 },
          { value: "rafi", charged_micro: 5e6, calls: 402 },
        ],
        880_000,
      ),
      "GET /orgs/7/usage/by-tag?key=customer&days=1": usage([
        { value: "rafi", charged_micro: 5e6, calls: 40 },
      ]),
      "GET /orgs/7/balance?limit=0": { balance_micro: 18.4e6 },
    });
    const c = await customers("key", f);
    expect(c).toMatchObject({
      balanceUsd: 18.4,
      defaultDailyUsd: 1,
      billedUsd: 7.1,
      ownUseUsd: 0.88,
    });
    expect(c.customers.map((x) => [x.id, x.monthUsd, x.dailyUsd, x.ownLimit, x.status])).toEqual([
      ["maya", 2.1, 1, false, "active"],
      ["rafi", 5, 5, true, "at-limit"],
      ["tan", 0, 1, false, "blocked"],
    ]);
  });

  it("mints a key that reaches the catalog, pinned to the customer, only in a team with no tools of its own", async () => {
    const ok = fakeTreg({
      "GET /auth/me": me,
      "GET /tools": [],
      "POST /orgs/7/agents": { token: "trg_new" },
      "PUT /orgs/7/budgets/customer/maya": {},
    });
    expect(await addCustomer("key", "maya", 5, ok.f)).toBe("trg_new");
    expect(ok.sent.find((s) => s.route === "POST /orgs/7/agents")?.body).toMatchObject({
      name: "gradcode-maya",
      tool_access: null,
      local_run_enabled: false,
      pinned_tags: { customer: "maya" },
    });
    expect(ok.sent.at(-1)?.body).toEqual({ daily_cap_micro: 5e6 });

    const own = fakeTreg({
      "GET /auth/me": me,
      "GET /tools": [{ name: "x" }, { name: "youtube" }],
    });
    await expect(addCustomer("key", "maya", null, own.f)).rejects.toThrow(
      /own tools \(x, youtube\)/,
    );
    expect(own.sent.some((s) => s.route.startsWith("POST"))).toBe(false);
  });
});

describe("signing in at treg.to", () => {
  it("waits for approval, then swaps the login for the chosen team's own key", async () => {
    expect(await pollLogin("l1", fakeTreg({ "GET /auth/cli/poll?login_id=l1": {} }).f)).toBeNull();
    const { f, sent } = fakeTreg({
      "GET /auth/cli/poll?login_id=l1": { token: "identity", active_org: "maya-team" },
      "GET /auth/cli-token": { token: "team-key" },
    });
    expect(await pollLogin("l1", f)).toBe("team-key");
    expect(sent[1]?.headers.get("X-Treg-Org")).toBe("maya-team");
  });
});
