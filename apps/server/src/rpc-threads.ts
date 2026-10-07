// The thread methods: start, send (queue, steer), scope, detail, fork, settle and the rest.
// rpc.ts spreads these into its handlers.
import { ROW_OPS, type ScopeItem } from "@gradcode/contracts";
import { scopeNote, threadProposals, threadRows } from "./records.ts";
import type { Handlers, Services } from "./rpc.ts";
import {
  addScope,
  createThread,
  forkThread,
  getThread,
  listEvents,
  listThreads,
  markUnread,
  rename,
  rowCosts,
  searchThreads,
  setDetail,
  settle,
  snooze,
} from "./threads.ts";
import { readAttachments } from "./vault.ts";

type ThreadMethods = Extract<keyof Handlers, `threads.${string}`>;

const OK = { ok: true } as const;

export function threadHandlers(svc: Services): Pick<Handlers, ThreadMethods> {
  const { db, bus, runner } = svc;
  const pushThreads = () => bus.push({ type: "threads", threads: listThreads(db) });
  const thread = (id: string) => {
    const t = getThread(db, id);
    if (!t) throw new Error(`No thread ${id}`);
    return t;
  };

  /**
   * Sends a message, first widening the thread's scope with what it names. What the sheet knows
   * about anything new rides along for the agent; the transcript shows only what was typed.
   */
  function send(
    id: string,
    text: string,
    delivery: "send" | "queued" | "steered",
    attachments: string[],
    scope: ScopeItem[],
  ) {
    const note = scopeNote(db, addScope(db, id, scope));
    runner.send(
      id,
      note ? `${text}\n\n${note}` : text,
      delivery,
      text,
      readAttachments(db, attachments),
    );
  }

  return {
    "threads.list": () => listThreads(db),
    "threads.create": ({ text, title, attachments = [], scope = [] }) => {
      // The title reads like the message: an Ask's "[ask]" tag stays out of it.
      const t = createThread(
        db,
        title ??
          text
            .replace(/^\[ask\]\s*/, "")
            .replace(/\s+/g, " ")
            .slice(0, 60),
      );
      send(t.id, text, "send", attachments, scope);
      return thread(t.id);
    },
    "threads.view": ({ id }) => ({
      thread: thread(id),
      events: listEvents(db, id),
      rows: threadRows(db, id),
      proposals: threadProposals(db, id),
      costs: rowCosts(db, id),
    }),
    "threads.search": ({ q }) => searchThreads(db, q),
    "threads.send": ({ id, text, delivery, attachments = [], scope = [] }) => {
      thread(id);
      send(id, text, delivery, attachments, scope);
      return OK;
    },
    "threads.setDetail": ({ id, detail }) => {
      thread(id);
      setDetail(db, id, detail);
      pushThreads();
      return OK;
    },
    "threads.fork": ({ id }) => {
      const copy = forkThread(db, id);
      pushThreads();
      return copy;
    },
    "threads.editQueued": ({ threadId, eventId, text }) => {
      if (!runner.editQueued(threadId, eventId, text))
        throw new Error("That message already went out.");
      return OK;
    },
    "threads.steerQueued": ({ threadId, eventId }) => {
      if (!runner.steerQueued(threadId, eventId)) throw new Error("That message already went out.");
      return OK;
    },
    "threads.moveQueued": ({ threadId, eventId, by }) => {
      if (!runner.moveQueued(threadId, eventId, by))
        throw new Error("That message already went out.");
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
      rename(db, id, title.trim());
      pushThreads();
      return OK;
    },
    "threads.startRowAction": ({ op, keys }) => {
      const t = createThread(
        db,
        `${ROW_OPS[op].label} · ${keys.length} professor${keys.length === 1 ? "" : "s"}`,
      );
      runner.rowAction(t.id, op, keys);
      return thread(t.id);
    },
    "threads.rowAction": ({ id, op, keys }) => {
      thread(id);
      runner.rowAction(id, op, keys);
      return OK;
    },
  };
}
