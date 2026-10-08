#!/usr/bin/env node
// A treg team's customers from the command line, for scripting. Settings does the same in the
// app for an owner or admin; both call src/treg-org.ts.
//
//   TREG_ADMIN_TOKEN=... node apps/server/scripts/treg-admin.ts <command>
//
//   customers                                  everyone with a key: spend, limit, status
//   add <customer> [--daily 5]                 mint a key pinned to them; optional daily limit
//   key <customer>                             a new key; the old one stops working
//   cap <customer> <usd-per-day>               change their daily limit
//   default <usd-per-day>                      the daily limit of everyone without their own
//   block <customer> | unblock <customer>      stop or resume their paid lookups
//   remove <customer>                          revoke their key; their spend stays invoiced
//   balance                                    what is left to spend; every call fails at zero
//   invoice [--days 30]                        per-customer lines, refused if treg's ledger
//                                              doesn't reconcile
//
// TREG_ADMIN_TOKEN is a key of an owner or admin of the team that pays; the team comes from it.
import * as org from "../src/treg-org.ts";

const token = process.env.TREG_ADMIN_TOKEN;
if (!token) {
  console.error("Set TREG_ADMIN_TOKEN.");
  process.exit(1);
}

const [command, id = "", ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const args = [id, ...rest];
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

switch (command) {
  case "customers":
    console.table((await org.customers(token)).customers);
    break;
  case "add": {
    const daily = flag("daily");
    console.log(await org.addCustomer(token, id, daily ? Number(daily) : null));
    console.error(`\nThe key for ${id}, shown once. They paste it in Settings, Paid lookups.`);
    break;
  }
  case "key":
    console.log(await org.newKey(token, id));
    break;
  case "cap":
    await org.setCustomer(token, id, { dailyUsd: Number(rest[0]) });
    break;
  case "default":
    await org.setDefaultLimit(token, Number(id));
    break;
  case "block":
  case "unblock":
    await org.setCustomer(token, id, { blocked: command === "block" });
    break;
  case "remove":
    await org.removeCustomer(token, id);
    break;
  case "balance": {
    const usd = await org.balance(token);
    console.log(`$${usd.toFixed(6)}`);
    if (usd < 1) console.error("Under $1: top up at treg.to, or paid lookups stop.");
    break;
  }
  case "invoice": {
    const { lines, unattributedUsd } = await org.invoice(token, Number(flag("days") ?? 30));
    console.log("customer,calls,usd");
    for (const l of lines) console.log(`${l.customer},${l.calls},${l.usd.toFixed(6)}`);
    if (unattributedUsd > 0)
      console.error(`\n$${unattributedUsd.toFixed(6)} named no customer: the team's own keys.`);
    break;
  }
  default:
    console.error("Commands: customers, add, key, cap, default, block, unblock, remove, balance,");
    console.error("invoice. See the top of this file.");
    process.exit(1);
}
