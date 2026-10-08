import { describe, expect, it } from "vite-plus/test";
import { fixtureSources } from "./agent/fixtures.ts";
import { HUNT_TOOLS, type HuntTool } from "./agent/tools.ts";
import { openDb } from "./db.ts";
import { DEFAULT_SETTINGS } from "./state.ts";
import { createThread, rowCosts, usageSince } from "./threads.ts";
import { invoiceLines, tregCall } from "./treg.ts";

const login = { customer: "cust_8123", token: "tok_secret_123" };
const noWait = async () => {};

/** A fetch that answers from a script and records every request. */
function fakeFetch(answers: (() => Response)[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return next();
  };
  return { f: f as typeof fetch, seen };
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe("tregCall", () => {
  it("bills this install's customer, caps the call, and returns what it really cost", async () => {
    const { f, seen } = fakeFetch([
      () =>
        new Response(JSON.stringify({ email: "a@uni.edu" }), {
          headers: { "X-Treg-Cost-Micro": "4834", "X-Treg-Call-Id": "call_1" },
        }),
    ]);
    const out = await tregCall(
      {
        endpoint: "treg.people.email.find",
        data: { full_name: "Ada Testwell" },
        maxUsd: 0.02,
        tags: { thread: "thr_1", feature: "row-email", hunt: "hunt_9" },
      },
      login,
      f,
      noWait,
    );
    expect(out).toEqual({
      ok: true,
      result: { email: "a@uni.edu" },
      callId: "call_1",
      costUsd: 0.004834,
    });
    const req = seen[0]!;
    expect(req.url).toBe("https://treg.to/call/treg.people.email.find");
    expect(header(req.init, "X-Treg-Meta")).toBe(
      "customer=cust_8123, thread=thr_1, feature=row-email, hunt=hunt_9",
    );
    expect(header(req.init, "X-Treg-Route-Max-Cost")).toBe("0.02");
    expect(header(req.init, "X-Treg-Token")).toBe("tok_secret_123");
  });

  it("retries a lost answer with the same Idempotency-Key, paying once and logging that charge", async () => {
    const { f, seen } = fakeFetch([
      () => {
        throw new TypeError("socket hang up");
      },
      () => new Response("{}", { status: 503, headers: { "Retry-After": "1" } }),
      // The replay of the first attempt, whose charge comes back apart.
      () =>
        new Response("{}", {
          headers: { "X-Treg-Cost-Micro": "0", "X-Treg-Original-Cost-Micro": "1780" },
        }),
    ]);
    const out = await tregCall(
      {
        endpoint: "millionverifier.people.email.verify",
        data: { email: "a@b.c" },
        maxUsd: 1,
        tags: { thread: "t", feature: "hunt" },
      },
      login,
      f,
      noWait,
    );
    expect(out).toMatchObject({ ok: true, costUsd: 0.00178 });
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((s) => header(s.init, "Idempotency-Key"))).size).toBe(1);
    // A GET endpoint takes its data as the query string.
    expect(seen[2]!.url).toBe(
      "https://treg.to/call/millionverifier.people.email.verify?email=a%40b.c",
    );
  });

  it("stops on a customer cap and never shows the issuer's balance", async () => {
    const refuse = (status: number, body: unknown) => () =>
      new Response(JSON.stringify(body), { status, headers: { "X-Treg-Error": "1" } });
    const req = {
      endpoint: "treg.google.serp.organic",
      data: {},
      maxUsd: 0.015,
      tags: { thread: "t", feature: "loop" },
    };
    const capped = await tregCall(
      req,
      login,
      fakeFetch([
        refuse(429, {
          error: "tag_spend_cap_reached",
          spent_micro: 5e6,
          cap_micro: 5e6,
          period: "day",
        }),
      ]).f,
      noWait,
    );
    expect(capped).toMatchObject({ ok: false, stop: true });
    expect(capped.ok ? "" : capped.reason).toContain("$5 of $5 this day");

    const broke = await tregCall(
      req,
      login,
      fakeFetch([
        refuse(402, {
          error: "insufficient_balance",
          balance_micro: 120,
          topup_url: "https://treg.to/topup",
        }),
      ]).f,
      noWait,
    );
    expect(broke).toMatchObject({ ok: false, stop: true });
    expect(JSON.stringify(broke)).not.toMatch(/topup|balance_micro|120/);
  });

  it("refuses an endpoint that isn't on the list without calling treg", async () => {
    const { f, seen } = fakeFetch([]);
    const out = await tregCall(
      { endpoint: "stripe.charges", data: {}, maxUsd: 1, tags: { thread: "t", feature: "hunt" } },
      login,
      f,
      noWait,
    );
    expect(out.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });
});

describe("the treg tool", () => {
  it("records each call's real cost under its call id, by row action and sheet row", async () => {
    const db = openDb(":memory:");
    const threadId = createThread(db, "t").id;
    const treg: HuntTool | undefined = HUNT_TOOLS.find((t) => t.name === "treg");
    const stops: string[] = [];
    const ctx = {
      db,
      threadId,
      settings: DEFAULT_SETTINGS,
      hunt: null,
      sources: {
        ...fixtureSources,
        treg: async () => ({
          ok: true as const,
          result: { status: "valid" },
          callId: "call_7",
          costUsd: 0.0123,
        }),
      },
      changed: () => {},
      outreachChanged: () => {},
      vaultChanged: () => {},
      ask: () => {},
      feature: () => "row-email",
      capHit: (reason: string) => stops.push(reason),
      spent: () => {},
      askOnly: () => false,
    };
    const r = await treg!.run(
      {
        endpoint: "treg.people.email.verify",
        data: { email: "a@uni.edu" },
        purpose: "check",
        about: "ada@uni",
      },
      ctx,
    );
    expect(r.summary).toBe("$0.0123");
    expect(rowCosts(db, threadId)).toEqual({ "ada@uni": { email: 0.0123 } });
    expect(usageSince(db, "2000-01-01")).toMatchObject({ usd: 0.0123, calls: 1 });
    expect(stops).toEqual([]);
  });
});

describe("invoice lines", () => {
  const report = {
    rows: [{ value: "cust_8123", charged_micro: 41234, calls: 22 }],
    attributed_micro: 41234,
    unattributed_micro: 1880,
    total_micro: 43114,
  };

  it("bills each customer from treg's ledger and shows what no customer was tagged for", () => {
    expect(invoiceLines(report)).toEqual({
      lines: [{ customer: "cust_8123", calls: 22, usd: 0.041234 }],
      unattributedUsd: 0.00188,
    });
  });

  it("refuses a report that doesn't add up", () => {
    expect(() => invoiceLines({ ...report, total_micro: 50000 })).toThrow(/reconcile/);
  });
});
