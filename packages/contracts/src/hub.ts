// The hub: any getmyprof install a counselor (or a friend) runs, which students connect to by
// choice. A student's install sends its progress report and, if they turn on "Give back", public
// facts; the hub serves back a shared catalog of public facts. getmyprof runs no service: the hub
// is the counselor's own install, on a tailnet or a tunnel.
import { z } from "zod";
import { Professor } from "./domain.ts";
import { ProgressReport } from "./report.ts";
import { Program, Scholarship } from "./vault.ts";

const checkedAt = z.string();

/**
 * One public fact in the shared catalog, with when its giver last checked it. Programs drop
 * `eligibility` (it is about one applicant), scholarships their applicant's status, and professors
 * keep only what any page shows: never fit, stage, notes, drafts or replies.
 */
export const CatalogFact = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("program"),
    checkedAt,
    item: Program.omit({ id: true, note: true, eligibility: true }),
  }),
  z.object({
    kind: z.literal("scholarship"),
    checkedAt,
    item: Scholarship.omit({ id: true, status: true, note: true }),
  }),
  z.object({
    kind: z.literal("professor"),
    checkedAt,
    item: Professor.pick({
      name: true,
      university: true,
      email: true,
      emailCheck: true,
      website: true,
      scholar: true,
      recent: true,
      taking: true,
      sources: true,
    }),
  }),
]);
export type CatalogFact = z.infer<typeof CatalogFact>;

/** What a student POSTs to /api/hub/facts when "Give back" is on. */
export const HubFacts = z.object({ facts: z.array(CatalogFact) });
export type HubFacts = z.infer<typeof HubFacts>;

/** What GET /api/hub/catalog serves: each fact and how many installs checked it. */
export const HubCatalog = z.object({
  facts: z.array(z.object({ fact: CatalogFact, by: z.number().int() })),
});
export type HubCatalog = z.infer<typeof HubCatalog>;

/** The invite code, base64url JSON: the hub's base URL, the student's token, and their name. */
export const HubInvite = z.object({
  u: z.url({ protocol: /^https?$/ }),
  t: z.string().min(16),
  n: z.string(),
});
export type HubInvite = z.infer<typeof HubInvite>;

/** A student connected to this hub, as its Students page shows them. */
export const HubStudent = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  /** When their last report arrived; null until the first. */
  syncedAt: z.string().nullable(),
  report: ProgressReport.nullable(),
});
export type HubStudent = z.infer<typeof HubStudent>;

/** This install as a student of a hub, or null when it isn't connected to one. */
export const HubStatus = z
  .object({
    host: z.string(),
    name: z.string(),
    takeCatalog: z.boolean(),
    giveBack: z.boolean(),
    lastSent: z.string().nullable(),
    lastPulled: z.string().nullable(),
    lastError: z.string(),
  })
  .nullable();
export type HubStatus = z.infer<typeof HubStatus>;

const ok = z.object({ ok: z.literal(true) });
const none = z.object({});

/** The hub's rpc methods; rpc.ts spreads them into Methods. */
export const HubMethods = {
  // The hub's owner.
  "hub.students": { input: none, output: z.array(HubStudent) },
  /** A new student's invite code, shown once. `url` is where students reach this hub. */
  "hub.invite": {
    input: z.object({ name: z.string().trim().min(1), url: z.string().optional() }),
    output: z.object({ code: z.string() }),
  },
  "hub.remove": { input: z.object({ id: z.string() }), output: ok },
  // A student's install.
  "hub.connect": { input: z.object({ code: z.string().min(1) }), output: HubStatus },
  "hub.disconnect": { input: none, output: HubStatus },
  "hub.status": { input: none, output: HubStatus },
  "hub.setMember": {
    input: z.object({ takeCatalog: z.boolean().optional(), giveBack: z.boolean().optional() }),
    output: HubStatus,
  },
  /** Sends the report, and pulls and gives back as set. Null when not connected. */
  "hub.syncNow": { input: none, output: HubStatus },
} as const;
