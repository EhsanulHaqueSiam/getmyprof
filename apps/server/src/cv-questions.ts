// What reading a CV couldn't settle becomes a question in Input, never a guess. Each open
// question fact goes to one thread, "Questions from your CV", which waits in Input; the
// applicant's reply there answers the oldest question: it becomes a fact (unconfirmed, so it
// still needs their proof before anything cites it). No agent turn, nothing spent.
import type { ThreadEvent } from "@getmyprof/contracts";
import { type Db, getKv, now, setKv } from "./db.ts";
import { getFacts, saveFacts } from "./state.ts";
import { createThread, getThread, listEvents, putEvent, setStatus } from "./threads.ts";
import { z } from "zod";

const THREAD = "cv.questions.thread";
const asked = (id: string) => `q-${id}`;

/** Puts every open question fact in Input, once. Returns the thread, or null when none is open. */
export function askCvQuestions(db: Db) {
  const open = getFacts(db).filter((f) => f.question);
  if (!open.length) return null;
  const saved = getKv(db, THREAD, (v) => z.string().parse(v), "");
  const threadId =
    (saved && getThread(db, saved)?.id) || createThread(db, "Questions from your CV").id;
  setKv(db, THREAD, threadId);
  const events = listEvents(db, threadId);
  for (const f of open)
    if (!events.some((e) => e.id === asked(f.id)))
      putEvent(db, threadId, {
        id: asked(f.id),
        at: now(),
        type: "question",
        text: f.text,
        status: "pending",
      });
  setStatus(db, threadId, "input");
  return threadId;
}

/**
 * The applicant's reply in the questions thread: it answers the oldest open question and turns
 * that question fact into a plain one. Returns the events to show, or null when the message
 * isn't for this thread (then it goes to the agent as usual).
 */
export function answerCvQuestion(db: Db, threadId: string, text: string): ThreadEvent[] | null {
  if (getKv(db, THREAD, (v) => z.string().parse(v), "") !== threadId) return null;
  const pending = listEvents(db, threadId).filter(
    (e) => e.type === "question" && e.status === "pending",
  );
  const q = pending[0];
  if (q?.type !== "question") return null;
  const factId = q.id.slice(2);
  saveFacts(
    db,
    getFacts(db).map((f) =>
      f.id === factId
        ? {
            ...f,
            text: `${f.text} ${text}`.trim(),
            question: false,
            confirmed: false,
            source: "your answer",
          }
        : f,
    ),
  );
  const events: ThreadEvent[] = [
    { id: `msg-${q.id}`, at: now(), type: "user", text, delivery: "send", attachments: [] },
    { ...q, status: "answered" },
    {
      id: `sys-${q.id}`,
      at: now(),
      type: "system",
      text: "Saved to your facts. Confirm it with its proof in the Vault before anything cites it.",
    },
  ];
  for (const e of events) putEvent(db, threadId, e);
  setStatus(db, threadId, pending.length > 1 ? "input" : "idle");
  return events;
}
