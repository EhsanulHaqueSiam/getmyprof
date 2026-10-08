// The mailbox and the Pipeline's methods: connect or sign in, sync, and act on drafts. rpc.ts
// spreads these into its handlers.
import { linkedinOpen } from "./outreach/linkedin.ts";
import { conversations } from "./outreach/pipeline.ts";
import { getMessage } from "./outreach/store.ts";
import type { Handlers, Services } from "./rpc.ts";

type MailMethods = Extract<keyof Handlers, `mail.${string}` | `outreach.${string}`>;
const OK = { ok: true } as const;

export function mailHandlers(svc: Services): Pick<Handlers, MailMethods> {
  const { db, bus, outreach } = svc;
  return {
    "mail.connect": (input) => outreach.connect(input),
    "mail.signIn": (input) => outreach.startSignIn(input),
    "mail.disconnect": () => outreach.disconnect(),
    "mail.repassword": ({ password }) => outreach.repassword(password),
    "mail.sync": () => outreach.sync(),
    "outreach.list": () => conversations(db),
    "outreach.approve": async ({ ids }) => {
      await outreach.approve(ids);
      return OK;
    },
    "outreach.sendNow": async ({ id }) => {
      await outreach.sendNow(id);
      return OK;
    },
    "outreach.edit": ({ id, subject, body }) => {
      outreach.edit(id, subject, body);
      return OK;
    },
    "outreach.cancel": ({ id }) => {
      outreach.cancel(id);
      return OK;
    },
    "outreach.linkedinOpen": async ({ id }) => {
      const m = getMessage(db, id);
      if (!m || m.channel !== "linkedin") throw new Error("No LinkedIn note to open.");
      const opened = await linkedinOpen(db, svc.sources, m.recordKey, m.to);
      // A lookup it paid for shows in today's spend.
      bus.push({ type: "changed", what: "state" });
      return opened;
    },
    "outreach.markSent": ({ id }) => {
      outreach.markSent(id);
      return OK;
    },
  };
}
