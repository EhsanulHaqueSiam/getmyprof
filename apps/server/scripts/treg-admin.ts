#!/usr/bin/env node
// The issuer's side of treg billing: mint a token pinned to one customer, cap or block them, and
// print invoice lines from treg's ledger. gradcode installs only ever hold a pinned token.
//
//   TREG_ADMIN_TOKEN=... node apps/server/scripts/treg-admin.ts <command>
//
//   add <customer> [--daily 5] [--calls 500]   mint a pinned token; optional daily cap in USD.
//                                               Again for the same customer rotates the token
//   cap <customer> <usd-per-day>               change the daily cap
//   default <usd-per-day>                      the daily cap of every customer without their own
//   block <customer> | unblock <customer>      stop or resume a customer's paid lookups
//   balance                                     what is left to spend; every call fails at zero
//   invoice [--days 30]                         per-customer lines, refused if treg's ledger
//                                               doesn't reconcile
//
// TREG_ADMIN_TOKEN is an org-scoped admin token with every tool, of the org that pays; the org
// comes from it. That org holds no tools of its own: treg's tool list can't name catalog
// endpoints, so a customer token gets every tool, and anything the team connected (an X or
// Google account) would be the customer's too. `add` refuses in an org that has any.
import { TagValue } from "@gradcode/contracts";
import { z } from "zod";
import { invoiceLines, TREG_BASE } from "../src/treg.ts";

const token = process.env.TREG_ADMIN_TOKEN;
if (!token) {
  console.error("Set TREG_ADMIN_TOKEN.");
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const micro = (usd: string) => Math.round(Number(usd) * 1e6);

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${TREG_BASE}${path}`, {
    method,
    headers: { "X-Treg-Token": token!, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const org = `/orgs/${z.object({ org_id: z.number() }).parse(await api("GET", "/auth/me")).org_id}`;
const budget = (customer: string, body: Record<string, unknown>) =>
  api("PUT", `${org}/budgets/customer/${customer}`, body);

const customer = () => TagValue.parse(rest[0]);

switch (command) {
  case "add": {
    const id = customer();
    const own = z.array(z.object({ name: z.string() })).parse(await api("GET", "/tools"));
    if (own.length)
      throw new Error(
        `This org has its own tools (${own.map((t) => t.name).join(", ")}), and a customer token would reach them. Mint in an org with none.`,
      );
    const calls = flag("calls");
    const agent = await api("POST", `${org}/agents`, {
      name: `gradcode-${id}`,
      role: "member",
      daily_call_cap: calls ? Number(calls) : -1,
      tool_access: null,
      local_run_enabled: false,
      pinned_tags: { customer: id },
    });
    const daily = flag("daily");
    if (daily) await budget(id, { daily_cap_micro: micro(daily) });
    console.log(JSON.stringify(agent, null, 2));
    console.log(`\nIn gradcode Settings > Paid lookups: customer ${id}, and the token above.`);
    break;
  }
  case "cap": {
    const id = customer();
    console.log(await budget(id, { daily_cap_micro: micro(rest[1] ?? "") }));
    break;
  }
  case "default": {
    console.log(
      await api("PUT", `${org}/budgets/customer`, { daily_cap_micro: micro(rest[0] ?? "") }),
    );
    break;
  }
  case "block":
  case "unblock": {
    const id = customer();
    console.log(await budget(id, { status: command === "block" ? "blocked" : "active" }));
    break;
  }
  case "invoice": {
    const days = Number(flag("days") ?? 30);
    const { lines, unattributedUsd } = invoiceLines(
      await api("GET", `${org}/usage/by-tag?key=customer&days=${days}`),
    );
    console.log("customer,calls,usd");
    for (const l of lines) console.log(`${l.customer},${l.calls},${l.usd.toFixed(6)}`);
    if (unattributedUsd > 0)
      console.error(
        `\n$${unattributedUsd.toFixed(6)} carried no customer tag: a call made with a key that isn't a customer's.`,
      );
    break;
  }
  case "balance": {
    const b = z
      .object({ balance_micro: z.number() })
      .parse(await api("GET", `${org}/balance?limit=0`));
    console.log(`$${(b.balance_micro / 1e6).toFixed(6)}`);
    if (b.balance_micro < 1e6)
      console.error("Under $1: top up or turn on auto top-up at treg.to, or paid lookups stop.");
    break;
  }
  default:
    console.error(
      "Commands: add, cap, default, block, unblock, balance, invoice. See the top of this file.",
    );
    process.exit(1);
}
