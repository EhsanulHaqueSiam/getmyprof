// The WebSocket API. Each method pairs an input schema with an output schema; the server
// validates inputs before dispatch and the client's `call` infers both sides from this map.
import { z } from "zod";
import {
  Applicant,
  Award,
  AwardSource,
  Hunt,
  HuntPrefs,
  Loop,
  Professor,
  ProfileFact,
  Proposal,
  Schedule,
  Settings,
  TregConnect,
  TregStatus,
} from "./domain.ts";
import { Conversation, MailConnect, MailSignIn, MailStatus } from "./outreach.ts";
import { RowOp, ThreadEvent, ThreadSummary } from "./threads.ts";
import {
  Application,
  DocKind,
  VaultDocument,
  VaultEdit,
  VaultState,
  WritingKind,
} from "./vault.ts";

const id = z.object({ id: z.string() });
const ok = z.object({ ok: z.literal(true) });

export const AppState = z.object({
  settings: Settings,
  hunt: Hunt.nullable(),
  applicant: Applicant,
  facts: z.array(ProfileFact),
  host: z.string(),
  adapters: z.object({ hq: z.boolean(), gradhunt: z.boolean(), treg: z.boolean() }),
  mail: MailStatus,
  treg: TregStatus,
  /** Where a phone on the tailnet opens gradcode, and whether it's being served there. */
  tailnet: z.object({ url: z.string(), served: z.boolean() }).nullable(),
});
export type AppState = z.infer<typeof AppState>;

export const ThreadView = z.object({
  thread: ThreadSummary,
  events: z.array(ThreadEvent),
  rows: z.array(Professor),
  proposals: z.array(Proposal),
  /** What row actions spent per sheet row, by row action: {key: {email: 0.0048}}. */
  costs: z.record(z.string(), z.record(z.string(), z.number())),
});
export type ThreadView = z.infer<typeof ThreadView>;

export const Methods = {
  "state.get": { input: z.object({}), output: AppState },
  "settings.update": { input: Settings.partial(), output: Settings },
  "hunt.save": { input: z.object({ name: z.string(), prefs: HuntPrefs }), output: Hunt },
  "applicant.save": { input: Applicant, output: Applicant },
  "facts.save": { input: z.object({ facts: z.array(ProfileFact) }), output: z.array(ProfileFact) },
  "facts.extract": {
    input: z.object({
      text: z.string(),
      links: z.array(z.string()),
      pdfBase64: z.string().optional(),
    }),
    output: z.array(ProfileFact),
  },

  "threads.list": { input: z.object({}), output: z.array(ThreadSummary) },
  "threads.create": {
    input: z.object({
      text: z.string().min(1),
      title: z.string().optional(),
      /** Vault document ids, read by the agent with the message. */
      attachments: z.array(z.string()).optional(),
    }),
    output: ThreadSummary,
  },
  "threads.view": { input: id, output: ThreadView },
  /** Full text across every thread's messages and tool calls. */
  "threads.search": {
    input: z.object({ q: z.string().min(2) }),
    output: z.array(z.object({ threadId: z.string(), title: z.string(), snippet: z.string() })),
  },
  "threads.send": {
    input: z.object({
      id: z.string(),
      text: z.string().min(1),
      delivery: z.enum(["send", "queued", "steered"]),
      attachments: z.array(z.string()).optional(),
    }),
    output: ok,
  },
  "threads.stop": { input: id, output: ok },
  /** Changes, or with text null removes, a queued message before it goes out. */
  "threads.editQueued": {
    input: z.object({
      threadId: z.string(),
      eventId: z.string(),
      text: z.string().min(1).nullable(),
    }),
    output: ok,
  },
  "threads.moveQueued": {
    input: z.object({
      threadId: z.string(),
      eventId: z.string(),
      by: z.union([z.literal(-1), z.literal(1)]),
    }),
    output: ok,
  },
  /** A copy to branch from: same transcript and rows; the agent continues as a fork. */
  "threads.fork": { input: id, output: ThreadSummary },
  "threads.settle": { input: z.object({ id: z.string(), settled: z.boolean() }), output: ok },
  "threads.snooze": {
    input: z.object({ id: z.string(), until: z.string().nullable() }),
    output: ok,
  },
  "threads.visit": { input: id, output: ok },
  "threads.rename": { input: z.object({ id: z.string(), title: z.string().min(1) }), output: ok },
  "threads.rowAction": {
    input: z.object({ id: z.string(), op: RowOp, keys: z.array(z.string()).min(1) }),
    output: ok,
  },

  "approvals.resolve": {
    input: z.object({
      threadId: z.string(),
      approvalId: z.string(),
      decision: z.enum(["once", "deny"]),
    }),
    output: ok,
  },
  "proposals.resolve": {
    input: z.object({ ids: z.array(z.string()).min(1), decision: z.enum(["accept", "reject"]) }),
    output: ok,
  },

  "records.list": { input: z.object({}), output: z.array(Professor) },
  "records.get": {
    input: z.object({ key: z.string() }),
    output: z.object({
      record: Professor,
      threads: z.array(ThreadSummary),
      proposals: z.array(Proposal),
    }),
  },
  "records.import": {
    input: z.object({ csv: z.string() }),
    output: z.object({ added: z.number() }),
  },
  "records.export": { input: z.object({}), output: z.object({ csv: z.string() }) },

  "funding.search": {
    input: z.object({
      terms: z.array(z.string()).min(1),
      universities: z.array(z.string()),
      /** Which databases; by default the ones that cover the hunt's places. */
      sources: z.array(AwardSource).optional(),
    }),
    output: z.array(Award),
  },

  "loops.list": { input: z.object({}), output: z.array(Loop) },
  "loops.save": {
    input: z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      instructions: z.string().min(1),
      schedule: Schedule,
      budgetUsd: z.number(),
      enabled: z.boolean(),
      reportTo: z.enum(["fresh", "same"]).optional(),
    }),
    output: Loop,
  },
  "loops.run": { input: id, output: ThreadSummary },

  /** Verifies the login against both servers before saving it. */
  "mail.connect": { input: MailConnect, output: MailStatus },
  /** The provider's consent page; its callback connects the mailbox and returns to Settings. */
  "mail.signIn": { input: MailSignIn, output: z.object({ url: z.string() }) },
  "mail.disconnect": { input: z.object({}), output: MailStatus },
  /** A new app password for the connected mailbox; its warm-up and queue stay. */
  "mail.repassword": { input: z.object({ password: z.string().min(1) }), output: MailStatus },
  "mail.sync": { input: z.object({}), output: MailStatus },

  /** Checks the pinned token with treg before saving it; switches paid lookups on. */
  "treg.connect": { input: TregConnect, output: TregStatus },
  "treg.disconnect": { input: z.object({}), output: TregStatus },

  "outreach.list": { input: z.object({}), output: z.array(Conversation) },
  /** Schedules drafts into send slots; replies and LinkedIn notes are ready at once. */
  "outreach.approve": { input: z.object({ ids: z.array(z.string()).min(1) }), output: ok },
  "outreach.sendNow": { input: id, output: ok },
  "outreach.edit": {
    input: z.object({ id: z.string(), subject: z.string(), body: z.string().min(1) }),
    output: ok,
  },
  "outreach.cancel": { input: id, output: ok },
  /** LinkedIn is assisted: the user sends it there, then marks it sent here. */
  "outreach.markSent": { input: id, output: ok },

  "vault.get": { input: z.object({}), output: VaultState },
  "vault.save": { input: VaultEdit, output: ok },
  "vault.remove": {
    input: z.object({
      kind: z.enum(["document", "scholarship", "program", "application", "writing", "offer"]),
      id: z.string(),
    }),
    output: ok,
  },
  "documents.upload": {
    input: z.object({
      name: z.string().min(1),
      kind: DocKind,
      mime: z.string(),
      base64: z.string().min(1),
      expires: z.string().nullable(),
    }),
    output: VaultDocument,
  },
  /** File one of the agent's finds into the vault, or drop it for good. */
  "toFile.resolve": {
    input: z.object({ id: z.string(), decision: z.enum(["file", "dismiss"]) }),
    output: ok,
  },
  "applications.start": { input: z.object({ programId: z.string() }), output: Application },
  /** Asks the agent to write (or, with `basedOn`, tailor) a piece in a new thread. */
  "writing.start": {
    input: z.object({
      kind: WritingKind,
      programId: z.string().nullable(),
      scholarshipId: z.string().nullable(),
      basedOn: z.string().nullable(),
      /** A prep pack: who the interview is with. */
      about: z.string().nullable().optional(),
      /** A negotiation letter: the offer it's about. */
      offerId: z.string().nullable().optional(),
    }),
    output: ThreadSummary,
  },
  /** After an interview: the agent drafts a thank-you to that professor into the Pipeline. */
  "interviews.thank": {
    input: z.object({ applicationId: z.string(), interviewId: z.string() }),
    output: ThreadSummary,
  },
} as const;

export type Method = keyof typeof Methods;
export type MethodInput<M extends Method> = z.input<(typeof Methods)[M]["input"]>;
export type MethodOutput<M extends Method> = z.output<(typeof Methods)[M]["output"]>;

export const ClientRequest = z.object({ id: z.number(), method: z.string(), params: z.unknown() });
export type ClientRequest = z.infer<typeof ClientRequest>;

/** Everything the server sends: replies to requests, and pushes when state changes. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello") }),
  z.object({
    type: z.literal("reply"),
    id: z.number(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal("threads"), threads: z.array(ThreadSummary) }),
  z.object({ type: z.literal("event"), threadId: z.string(), event: ThreadEvent }),
  z.object({
    type: z.literal("changed"),
    what: z.enum(["records", "proposals", "loops", "state", "outreach", "vault", "thread"]),
    threadId: z.string().optional(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
