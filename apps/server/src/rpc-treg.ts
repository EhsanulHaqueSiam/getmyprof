// Settings' treg methods: connect a key (pasted, or by signing in at treg.to) and, for a team's
// owner or admin, manage its customers. rpc.ts spreads these into its handlers.
import type { Db } from "./db.ts";
import type { Handlers, Services } from "./rpc.ts";
import { updateSettings } from "./state.ts";
import { usageSince } from "./threads.ts";
import { readTregLogin, removeTregLogin, saveTregLogin } from "./treg.ts";
import * as org from "./treg-org.ts";

type TregMethods = Extract<keyof Handlers, `treg.${string}`>;

const SIGN_IN_MS = 3 * 60_000;

/** This install's treg login (never the key) and what paid lookups cost this calendar month. */
export function tregStatus(db: Db) {
  const login = readTregLogin();
  const d = new Date();
  return {
    connected: login !== null,
    org: login?.org || login?.customer || "",
    issued: login?.issued ?? false,
    manage: login ? org.canManage(login.role) : false,
    month: usageSince(db, new Date(d.getFullYear(), d.getMonth(), 1).toISOString()),
  };
}

export function tregHandlers(svc: Services): Pick<Handlers, TregMethods> {
  const { db, bus } = svc;
  // The sign-in being waited on; a newer one replaces it.
  let waiting: string | null = null;
  const status = () => tregStatus(db);

  /** Asks treg who the key is, saves it, and switches paid lookups on. */
  async function connect(token: string) {
    // The scripted stack never reaches treg.
    const who = svc.fake
      ? { org: "scripted", role: "member", issued: true }
      : await org.whoIs(token);
    saveTregLogin({ token, org: who.org, role: who.role, issued: who.issued });
    updateSettings(db, { treg: true });
    bus.push({ type: "changed", what: "state" });
    return status();
  }

  /** The key of a team this user manages; refuses everyone else. */
  const admin = () => {
    const login = readTregLogin();
    if (!login || !org.canManage(login.role))
      throw new Error("Only an owner or admin of the treg team can manage its customers.");
    return login.token;
  };

  return {
    "treg.connect": ({ token }) => connect(token),

    "treg.signIn": async () => {
      if (svc.fake) {
        setTimeout(() => void connect("scripted-key"), 300);
        return { url: "", code: "TEST" };
      }
      const login = await org.startLogin();
      waiting = login.id;
      void (async () => {
        for (const until = Date.now() + SIGN_IN_MS; waiting === login.id && Date.now() < until;) {
          await new Promise((r) => setTimeout(r, 2000));
          const key = await org.pollLogin(login.id).catch(() => null);
          if (key && waiting === login.id) {
            waiting = null;
            await connect(key).catch((e) => console.error("treg sign-in:", e));
          }
        }
      })();
      return { url: login.url, code: login.code };
    },

    "treg.disconnect": () => {
      waiting = null;
      removeTregLogin();
      updateSettings(db, { treg: false });
      bus.push({ type: "changed", what: "state" });
      return status();
    },

    "treg.customers": () => org.customers(admin()),
    "treg.addCustomer": async ({ customer, dailyUsd }) => ({
      key: await org.addCustomer(admin(), customer, dailyUsd),
    }),
    "treg.newKey": async ({ customer }) => ({ key: await org.newKey(admin(), customer) }),
    "treg.setCustomer": async ({ customer, ...patch }) => {
      await org.setCustomer(admin(), customer, patch);
      return org.customers(admin());
    },
    "treg.removeCustomer": async ({ customer }) => {
      await org.removeCustomer(admin(), customer);
      return org.customers(admin());
    },
    "treg.setDefaultLimit": async ({ dailyUsd }) => {
      await org.setDefaultLimit(admin(), dailyUsd);
      return org.customers(admin());
    },
    "treg.invoice": ({ days }) => org.invoice(admin(), days),
    "treg.topUp": async ({ usd }) => ({ url: await org.topUp(admin(), usd) }),
  };
}
