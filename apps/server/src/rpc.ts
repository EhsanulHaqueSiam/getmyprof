import {
  type Method,
  type MethodOutput,
  Methods,
  PORTAL_TAG,
  type ThreadSummary,
} from "@getmyprof/contracts";
import type { z } from "zod";
import {
  importGradhunt,
  profileFacts,
  readHqFacts,
  scoutLoop,
  writeBackToGradhunt,
} from "./adapters.ts";
import { claudeStatus, ensureClaude, loginCode, startLogin } from "./agent/binary.ts";
import { extractFacts, fakeFacts } from "./agent/extract.ts";
import type { Runner } from "./agent/runner.ts";
import { type Sources } from "./agent/tools.ts";
import type { Bus } from "./bus.ts";
import { type Db, getKv, newId, now } from "./db.ts";
import { claudeLogin, health, tailnetLink } from "./health.ts";
import { listLoops, loopStats, saveLoop, STARTER_LOOPS } from "./loops.ts";
import type { Outreach } from "./outreach/service.ts";
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
import { progressReport } from "./report.ts";
import { recordHandlers } from "./rpc-records.ts";
import { hubHandlers } from "./rpc-hub.ts";
import { studentCount } from "./hub.ts";
import { askCvQuestions } from "./cv-questions.ts";
import { mailHandlers } from "./rpc-mail.ts";
import { threadHandlers } from "./rpc-threads.ts";
import { tregHandlers, tregStatus } from "./rpc-treg.ts";
import { readTregLogin } from "./treg.ts";
import {
  createThread,
  daySpendOutsideThreads,
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
  const changedState = () => bus.push({ type: "changed", what: "state" });
  const thread = (id: string) => {
    const t = getThread(db, id);
    if (!t) throw new Error(`No thread ${id}`);
    return t;
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
        treg: tregStatus(db),
        tailnet: svc.fake ? null : tailnetLink(),
        claude: svc.fake
          ? { signedIn: true, who: "the scripted agent", binary: { state: "ready" } }
          : { ...claudeLogin(), binary: claudeStatus() },
        counts: {
          funding: getKv(db, "funding.waiting", Number, 0),
          loops: listLoops(db).filter((l) => l.enabled).length,
          spendOutsideThreads: daySpendOutsideThreads(db),
          students: studentCount(db),
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
      // What the CV couldn't settle waits in Input as a question.
      if (askCvQuestions(db)) pushThreads();
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

    "hunt.adjacent": async ({ fields }) =>
      fields.length ? await svc.sources.adjacent(fields).catch(() => []) : [],
    "loops.list": () => listLoops(db).map((l) => ({ ...l, ...loopStats(db, l.id) })),
    // Only where gradhunt sync is on: Siam's install. Read-only.
    "loops.scout": () => (getSettings(db).gradhunt ? scoutLoop() : null),
    "loops.save": (input) => {
      const loop = saveLoop(db, input);
      bus.push({ type: "changed", what: "loops" });
      // The sidebar counts loops on.
      bus.push({ type: "changed", what: "state" });
      return loop;
    },
    "loops.run": ({ id }) => svc.startLoop(id),

    ...mailHandlers(svc),
    "claude.fetch": () => {
      void ensureClaude(changedState).catch(() => undefined);
      return { ok: true as const };
    },
    "claude.login": async () => {
      if (svc.fake) throw new Error("The scripted agent needs no sign-in.");
      return { url: await startLogin(changedState) };
    },
    "claude.loginCode": ({ code }) => {
      loginCode(code);
      return { ok: true as const };
    },

    ...tregHandlers(svc),
    ...hubHandlers(svc),

    "vault.get": () => vaultState(db),
    "report.get": () => progressReport(db),
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
    "applications.suggestAnswers": ({ id, fields }) => {
      const s = vaultState(db);
      const app = s.applications.find((a) => a.id === id);
      const program = s.programs.find((p) => p.id === app?.programId);
      if (!app || !program) throw new Error("No such application");
      const title = `Portal · ${program.university}`;
      const lines = fields.map(
        (f) =>
          `- ${f.label} | ${f.kind}${f.required ? " | required" : ""}${f.options.length ? ` | options: ${f.options.join("; ")}` : ""}`,
      );
      const t = createThread(db, title);
      runner.send(
        t.id,
        `${PORTAL_TAG} app=${app.id}\nThe applicant is filling the ${program.university} ${program.name} portal. For each field below, give the answer from what you know about them (vault_search; their setup, confirmed facts, the Writer's pieces for this program) and save them with save_answers, the label exactly as given. Short answers: plain words in the applicant's voice, within any limit in the label, only what confirmed facts back. Leave out what only they know (a phone number, an address, a passport number). For a select or radio, answer with one of its options.\n${lines.join("\n")}`,
        "send",
        title,
      );
      return thread(t.id);
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
