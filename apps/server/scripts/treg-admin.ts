#!/usr/bin/env node
// The issuer's side of treg billing: mint a token pinned to one customer, cap or block them, and
// print invoice lines from treg's ledger. gradcode installs only ever hold a pinned token.
//
//   TREG_ADMIN_TOKEN=... TREG_ORG_ID=... node apps/server/scripts/treg-admin.ts <command>
//
//   add <customer> [--daily 5] [--calls 500]   mint a pinned token; optional daily cap in USD
//   cap <customer> <usd-per-day>               change the daily cap
//   block <customer> | unblock <customer>      stop or resume a customer's paid lookups
//   invoice [--days 30]                         per-customer lines, refused if treg's ledger
//                                               doesn't reconcile
//
// TREG_ADMIN_TOKEN is an org-scoped admin token (`treg org agent-new <name> --role admin`).
// Minting goes through the HTTP API, not `treg org agent-new`: run without a terminal, the CLI
// gives a new token every team tool, and a customer must never reach the team's own keys.
import { TagValue } from "@gradcode/contracts";
import { invoiceLines, TREG_BASE } from "../src/treg.ts";

const token = process.env.TREG_ADMIN_TOKEN;
const org = process.env.TREG_ORG_ID;
if (!token || !org) {
  console.error("Set TREG_ADMIN_TOKEN and TREG_ORG_ID.");
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const micro = (usd: string) => Math.round(Number(usd) * 1e6);

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${TREG_BASE}/orgs/${org}${path}`, {
    method,
    headers: { "X-Treg-Token": token!, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const budget = (customer: string, body: Record<string, unknown>) =>
  api("PUT", `/budgets/customer/${customer}`, body);

const customer = () => TagValue.parse(rest[0]);

switch (command) {
  case "add": {
    const id = customer();
    const calls = flag("calls");
    const agent = await api("POST", "/agents", {
      name: `gradcode-${id}`,
      role: "member",
      daily_call_cap: calls ? Number(calls) : -1,
      tool_access: [],
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
  case "block":
  case "unblock": {
    const id = customer();
    console.log(await budget(id, { status: command === "block" ? "blocked" : "active" }));
    break;
  }
  case "invoice": {
    const days = Number(flag("days") ?? 30);
    const { lines, unattributedUsd } = invoiceLines(
      await api("GET", `/usage/by-tag?key=customer&days=${days}`),
    );
    console.log("customer,calls,usd");
    for (const l of lines) console.log(`${l.customer},${l.calls},${l.usd.toFixed(6)}`);
    if (unattributedUsd > 0)
      console.error(
        `\n$${unattributedUsd.toFixed(6)} carried no customer tag: find the call site.`,
      );
    break;
  }
  default:
    console.error("Commands: add, cap, block, unblock, invoice. See the top of this file.");
    process.exit(1);
}
