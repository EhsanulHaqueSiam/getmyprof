import { type Method, type MethodOutput, Methods, type ThreadSummary } from "@gradcode/contracts";
import type { z } from "zod";
import {
  importGradhunt,
  profileFacts,
  readHqFacts,
  scoutLoop,
  writeBackToGradhunt,
} from "./adapters.ts";
import { extractFacts, fakeFacts } from "./agent/extract.ts";
import type { Runner } from "./agent/runner.ts";
import { type Sources } from "./agent/tools.ts";
import type { Bus } from "./bus.ts";
import { type Db, getKv, newId, now } from "./db.ts";
import { health, tailnetLink } from "./health.ts";
import { listLoops, loopStats, saveLoop, STARTER_LOOPS } from "./loops.ts";
import type { Outreach } from "./outreach/service.ts";
import { conversations } from "./outreach/pipeline.ts";
import {
  findsWaiting,
  listPrograms,
  removeEntry,
  resolveFinding,
  saveDocument,
  saveEdit,
  startApplication,
  vaultState,
  writingBrief,
} from "./vault.ts";
import { resolveProposal } from "./records.ts";
import {
  getApplicant,
  getHunt,
  getSettings,
  saveApplicant,
  saveFacts,
  saveHunt,
  updateSettings,
} from "./state.ts";
import { recordHandlers } from "./rpc-records.ts";
import { threadHandlers } from "./rpc-threads.ts";
import { checkTregToken, readTregLogin, removeTregLogin, saveTregLogin } from "./treg.ts";
import {
  createThread,
  usageSince,
  getThread,
  listThreads,
  putEvent,
  settleIfDone,
} from "./threads.ts";

type Input<M extends Method> = z.output<(typeof Methods)[M]["input"]>;
export type Handlers = {
  [M in Method]: (input: Input<M>) => MethodOutput<M> | Promise<MethodOutput<M>>;
};

const OK = { ok: true } as const;

export type Services = {
  db: Db;
  bus: Bus;
  runner: Runner;
  sources: Sources;
  fake: boolean;
  startLoop: (id: string) => ThreadSummary;
  outreach: Outreach;
};

export function createHandlers(svc: Services): Handlers {
  const { db, bus, runner, outreach } = svc;
  const pushThreads = () => bus.push({ type: "threads", threads: listThreads(db) });
  const thread = (id: string) => {
    const t = getThread(db, id);
    if (!t) throw new Error(`No thread ${id}`);
    return t;
  };

  /** This install's treg login (never the token) and what paid lookups cost this calendar month. */
  const tregStatus = () => {
    const login = readTregLogin();
    const d = new Date();
    return {
      connected: login !== null,
      customer: login?.customer ?? "",
      month: usageSince(db, new Date(d.getFullYear(), d.getMonth(), 1).toISOString()),
    };
  };

  return {
    "state.get": () => {
      const settings = getSettings(db);
      const h = health();
      return {
        settings,
        hunt: getHunt(db),
        applicant: getApplicant(db),
        facts: profileFacts(db),
        host: h.host,
        adapters: {
          hq: readHqFacts().length > 0,
          gradhunt: h.checks.scout,
          treg: svc.fake || readTregLogin() !== null,
        },
        mail: outreach.status(),
        treg: tregStatus(),
        tailnet: svc.fake ? null : tailnetLink(),
        counts: {
          funding: getKv(db, "funding.waiting", Number, 0),
          loops: listLoops(db).filter((l) => l.enabled).length,
        },
      };
    },
    "settings.update": (patch) => {
      const before = getSettings(db);
      const next = updateSettings(db, patch);
      if (next.gradhunt && !before.gradhunt) importGradhunt(db);
      if (next.setupDone && !before.setupDone && listLoops(db).length === 0)
        for (const l of STARTER_LOOPS)
          saveLoop(db, { ...l, budgetUsd: next.budget.perLoopRun, enabled: true });
      bus.push({ type: "changed", what: "state" });
      return next;
    },
    "hunt.save": ({ name, prefs }) => {
      const hunt = saveHunt(db, name, prefs);
      // Follow-up timing lives in the prefs, so the Pipeline's due dates move with it.
      bus.push({ type: "changed", what: "outreach" });
      return hunt;
    },
    "applicant.save": (applicant) => saveApplicant(db, applicant),
    "facts.save": ({ facts }) => {
      const saved = saveFacts(db, facts);
      // Every view of the facts (Lifeline, Facts, the Writer's checks) and the bundle follow.
      bus.push({ type: "changed", what: "state" });
      return saved;
    },
    "facts.extract": async (input) =>
      svc.fake ? fakeFacts() : extractFacts(input, getSettings(db).model),

    ...threadHandlers(svc),

    "approvals.resolve": ({ approvalId, decision }) => {
      runner.resolveApproval(approvalId, decision);
      return OK;
    },
    "proposals.resolve": ({ ids, decision }) => {
      const touched = new Set<string>();
      for (const id of ids) {
        const r = resolveProposal(db, id, decision);
        if (!r) continue;
        touched.add(r.proposal.threadId);
        if (r.record && getSettings(db).gradhunt)
          void writeBackToGradhunt(r.record, r.proposal.changes);
      }
      for (const threadId of touched) {
        if (settleIfDone(db, threadId)) {
          const event = {
            id: newId("sys"),
            at: now(),
            type: "system" as const,
            text: "Settled · nothing waits on you",
          };
          putEvent(db, threadId, event);
          bus.push({ type: "event", threadId, event });
        }
        bus.push({ type: "changed", what: "proposals", threadId });
      }
      bus.push({ type: "changed", what: "records" });
      pushThreads();
      return OK;
    },

    ...recordHandlers(svc),

    "loops.list": () => listLoops(db).map((l) => ({ ...l, ...loopStats(db, l.id) })),
    // Only where gradhunt sync is on: Siam's install. Read-only.
    "loops.scout": () => (getSettings(db).gradhunt ? scoutLoop() : null),
    "loops.save": (input) => {
      const loop = saveLoop(db, input);
      bus.push({ type: "changed", what: "loops" });
      return loop;
    },
    "loops.run": ({ id }) => svc.startLoop(id),

    "mail.connect": (input) => outreach.connect(input),
    "mail.signIn": (input) => outreach.startSignIn(input),
    "mail.disconnect": () => outreach.disconnect(),
    "mail.sync": () => outreach.sync(),

    "treg.connect": async (login) => {
      // The scripted stack never reaches treg; a real install proves the token first.
      if (!svc.fake) await checkTregToken(login.token);
      saveTregLogin(login);
      updateSettings(db, { treg: true });
      bus.push({ type: "changed", what: "state" });
      return tregStatus();
    },
    "treg.disconnect": () => {
      removeTregLogin();
      updateSettings(db, { treg: false });
      bus.push({ type: "changed", what: "state" });
      return tregStatus();
    },

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
    "outreach.markSent": ({ id }) => {
      outreach.markSent(id);
      return OK;
    },

    "vault.get": () => vaultState(db),
    "vault.save": (edit) => {
      const before = saveEdit(db, edit);
      if (
        edit.kind === "application" &&
        edit.value.status === "submitted" &&
        !before?.submittedAt
      ) {
        const app = { ...edit.value, submittedAt: edit.value.submittedAt ?? now() };
        saveEdit(db, { kind: "application", value: app });
        const program = listPrograms(db).find((p) => p.id === app.programId);
        if (program) outreach.afterApplying(app, program);
      }
      bus.push({ type: "changed", what: "vault" });
      return OK;
    },
    "vault.remove": ({ kind, id }) => {
      removeEntry(db, kind, id);
      bus.push({ type: "changed", what: "vault" });
      return OK;
    },
    "documents.upload": (input) => {
      const doc = saveDocument(db, input);
      bus.push({ type: "changed", what: "vault" });
      return doc;
    },
    "toFile.resolve": ({ id, decision }) => {
      const f = resolveFinding(db, id, decision);
      // The thread that found it settles once nothing it found waits on the user.
      if (f?.threadId && !findsWaiting(db, f.threadId) && settleIfDone(db, f.threadId))
        pushThreads();
      bus.push({ type: "changed", what: "vault" });
      return OK;
    },
    "writing.start": (input) => {
      const brief = writingBrief(db, profileFacts(db), input);
      // A revision goes back to the thread that wrote the piece, so the agent keeps its context.
      const id =
        (brief.threadId && getThread(db, brief.threadId)?.id) ??
        createThread(db, brief.threadTitle).id;
      runner.send(id, brief.text, "send", brief.threadTitle);
      return thread(id);
    },
    "interviews.thank": ({ applicationId, interviewId }) => {
      const s = vaultState(db);
      const app = s.applications.find((a) => a.id === applicationId);
      const interview = app?.interviews.find((i) => i.id === interviewId);
      const program = s.programs.find((p) => p.id === app?.programId);
      if (!interview || !program) throw new Error("No such interview");
      return thread(outreach.thank(interview.with, program.university));
    },
    "applications.start": ({ programId }) => {
      const app = startApplication(db, programId);
      bus.push({ type: "changed", what: "vault" });
      return app;
    },
  };
}

/** Validates params against the method's schema, then calls its handler. */
export async function dispatch(handlers: Handlers, method: string, params: unknown) {
  if (!Object.hasOwn(Methods, method)) throw new Error(`Unknown method ${method}`);
  const m = method as Method;
  const input = Methods[m].input.parse(params ?? {});
  return (handlers[m] as (input: unknown) => unknown)(input);
}
