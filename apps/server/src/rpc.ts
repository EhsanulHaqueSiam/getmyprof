import {
  type Award,
  type Method,
  type MethodOutput,
  Methods,
  type ThreadSummary,
} from "@gradcode/contracts";
import type { z } from "zod";
import {
  exportCsv,
  importCsv,
  importGradhunt,
  profileFacts,
  readHqFacts,
  writeBackToGradhunt,
} from "./adapters.ts";
import { extractFacts, fakeFacts } from "./agent/extract.ts";
import type { Runner } from "./agent/runner.ts";
import { type Sources, sourceKey } from "./agent/tools.ts";
import type { Bus } from "./bus.ts";
import { type Db, newId, now } from "./db.ts";
import { health } from "./health.ts";
import { listLoops, saveLoop, STARTER_LOOPS } from "./loops.ts";
import type { Outreach } from "./outreach/service.ts";
import { conversations } from "./outreach/store.ts";
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
import { getRecord, listRecords, resolveProposal, threadProposals, threadRows } from "./records.ts";
import { intakeStart, monthsAfter, sameSchool, sourcesFor } from "./sources.ts";
import {
  getApplicant,
  getHunt,
  getSettings,
  saveApplicant,
  saveFacts,
  saveHunt,
  updateSettings,
} from "./state.ts";
import {
  createThread,
  getThread,
  listEvents,
  listThreads,
  markUnread,
  putEvent,
  rename,
  settle,
  settleIfDone,
  snooze,
} from "./threads.ts";

type Input<M extends Method> = z.output<(typeof Methods)[M]["input"]>;
type Handlers = { [M in Method]: (input: Input<M>) => MethodOutput<M> | Promise<MethodOutput<M>> };

const OK = { ok: true } as const;
/** "LYBARGER, KEVIN" and "Kevin Lybarger" are the same person. */
const personKey = (name: string) => {
  const parts = name.includes(",") ? name.split(",").toReversed().join(" ") : name;
  const w = parts.toLowerCase().split(/\s+/).filter(Boolean);
  return `${w[0]?.[0] ?? ""} ${w.at(-1) ?? ""}`;
};

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
  const { db, bus, runner, sources, outreach } = svc;
  const pushThreads = () => bus.push({ type: "threads", threads: listThreads(db) });
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
          treg: svc.fake || h.checks.treg,
        },
        mail: outreach.status(),
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
    "hunt.save": ({ name, prefs }) => saveHunt(db, name, prefs),
    "applicant.save": (applicant) => saveApplicant(db, applicant),
    "facts.save": ({ facts }) => saveFacts(db, facts),
    "facts.extract": async (input) =>
      svc.fake ? fakeFacts() : extractFacts(input, getSettings(db).model),

    "threads.list": () => listThreads(db),
    "threads.create": ({ text, title }) => {
      const t = createThread(db, title ?? text.replace(/\s+/g, " ").slice(0, 60));
      runner.send(t.id, text, "send");
      return thread(t.id);
    },
    "threads.view": ({ id }) => ({
      thread: thread(id),
      events: listEvents(db, id),
      rows: threadRows(db, id),
      proposals: threadProposals(db, id),
    }),
    "threads.send": ({ id, text, delivery }) => {
      thread(id);
      runner.send(id, text, delivery);
      return OK;
    },
    "threads.stop": async ({ id }) => {
      await runner.stop(id);
      return OK;
    },
    "threads.settle": ({ id, settled }) => {
      settle(db, id, settled);
      pushThreads();
      return OK;
    },
    "threads.snooze": ({ id, until }) => {
      snooze(db, id, until);
      pushThreads();
      return OK;
    },
    "threads.visit": ({ id }) => {
      markUnread(db, id, false);
      pushThreads();
      return OK;
    },
    "threads.rename": ({ id, title }) => {
      rename(db, id, title);
      pushThreads();
      return OK;
    },
    "threads.rowAction": ({ id, op, keys }) => {
      thread(id);
      runner.rowAction(id, op, keys);
      return OK;
    },

    "approvals.resolve": ({ approvalId, decision }) => {
      runner.resolveApproval(approvalId, decision === "once");
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

    "records.list": () => listRecords(db),
    "records.get": ({ key }) => {
      const record = getRecord(db, key);
      if (!record) throw new Error(`No professor ${key}`);
      const threadIds = db
        .prepare("SELECT thread_id FROM thread_rows WHERE record_key = ?")
        .all(key)
        .map((r) => String(r.thread_id));
      return {
        record,
        threads: threadIds.flatMap((id) => getThread(db, id) ?? []),
        proposals: threadIds
          .flatMap((id) => threadProposals(db, id))
          .filter((p) => p.recordKey === key),
      };
    },
    "records.import": ({ csv }) => {
      const added = importCsv(db, csv);
      bus.push({ type: "changed", what: "records" });
      return { added };
    },
    "records.export": () => ({ csv: exportCsv(db) }),

    "funding.search": async ({ terms, universities, sources: picked }) => {
      const records = listRecords(db);
      const hunt = getHunt(db);
      const which = picked?.length ? picked : sourcesFor(hunt?.prefs.places ?? []);
      const start = intakeStart(hunt?.prefs.intake ?? "");
      const activeAfter = start?.toISOString().slice(0, 10);
      const base = { terms, ...(activeAfter ? { activeAfter } : {}) };
      // Named schools filter every source. By default the sheet's schools filter the US pair,
      // and the other databases search the topic everywhere: the sheet's schools are mostly US.
      const sheetSchools = [...new Set(records.map((r) => r.university))].slice(0, 8);
      const runs = which.flatMap((s) => {
        const schools = universities.length
          ? universities
          : s === "NSF" || s === "NIH"
            ? sheetSchools
            : [];
        return (schools.length ? schools : [undefined]).map((u) =>
          sources[sourceKey(s)]({ ...base, ...(u ? { university: u } : {}) }),
        );
      });
      const found = (await Promise.allSettled(runs)).flatMap((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      const unique = [...new Map(found.map((a) => [`${a.source}:${a.id}`, a])).values()];
      return unique
        .map((a): Award => ({
          ...a,
          monthsAfterIntake: monthsAfter(a.ends, start),
          inSheet:
            !!a.pi &&
            records.some(
              (r) =>
                personKey(r.name) === personKey(a.pi) && sameSchool(r.university, a.university),
            ),
        }))
        .toSorted((a, b) => (b.monthsAfterIntake ?? -999) - (a.monthsAfterIntake ?? -999));
    },

    "loops.list": () => listLoops(db),
    "loops.save": (input) => {
      const loop = saveLoop(db, input);
      bus.push({ type: "changed", what: "loops" });
      return loop;
    },
    "loops.run": ({ id }) => svc.startLoop(id),

    "mail.connect": (input) => outreach.connect(input),
    "mail.disconnect": () => outreach.disconnect(),
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
