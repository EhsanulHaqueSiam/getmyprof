import { ROW_OPS, type RowOp, type ThreadEvent } from "@gradcode/contracts";
import type { Bus } from "../bus.ts";
import { type Db, newId, now } from "../db.ts";
import { getRecord, threadProposals } from "../records.ts";
import { profileFacts } from "../adapters.ts";
import { getApplicant, getHunt, getSettings } from "../state.ts";
import {
  listThreads,
  markUnread,
  putEvent,
  sessionId,
  setSession,
  setStatus,
  settle,
  settleIfDone,
  getThread,
  pendingQuestion,
  sharesSession,
  threadSpend,
} from "../threads.ts";
import { systemPrompt } from "./prompt.ts";
import type { AgentProvider, AgentSession, SessionHooks } from "./provider.ts";
import { type Sources, toolsFor } from "./tools.ts";

const ROW_INSTRUCTIONS: Record<RowOp, string> = {
  email:
    "Find and check the email address of each professor below. Use only addresses printed on an official page; if treg is available, verify deliverability with millionverifier. Record email and emailCheck for each with propose_professor.",
  lasts:
    "For each professor below, look up their active NSF and NIH awards and record money and how long it lasts after the intake (lasts) with propose_professor.",
  taking:
    "For each professor below, read their homepage or lab page and record whether they're taking students for the intake (taking) and how they want to be reached (contact) with propose_professor.",
  draft:
    "Draft a short first email for each professor below with draft_email (touch first). Skip apply-only professors and anyone without a reviewed address, and say so. The applicant approves each draft in Pipeline before anything is sent.",
};

/**
 * Runs agent sessions for threads and turns what they do into thread state: events, status,
 * approvals, unread. One live session per thread at most; a message to an idle thread with no
 * session starts one that resumes the thread's earlier conversation.
 */
export function createRunner(deps: {
  db: Db;
  bus: Bus;
  provider: AgentProvider;
  sources: Sources;
  /** The name drafts are signed with: the connected mailbox's display name. */
  signAs?: () => string;
}) {
  const { db, bus, provider, sources } = deps;
  const sessions = new Map<string, AgentSession>();
  const approvals = new Map<string, { threadId: string; resolve: (ok: boolean) => void }>();
  const turns = new Map<string, { at: number; spend: number; calls: number }>();

  const pushThreads = () => bus.push({ type: "threads", threads: listThreads(db) });

  function emit(threadId: string, event: ThreadEvent) {
    putEvent(db, threadId, event);
    bus.push({ type: "event", threadId, event });
    const turn = turns.get(threadId);
    if (turn && event.type === "tool" && event.status !== "running") turn.calls++;
  }

  function hooksFor(threadId: string): SessionHooks {
    return {
      emit: (event) => emit(threadId, event),
      sessionId: (id) => setSession(db, threadId, id),
      turnStarted() {
        turns.set(threadId, { at: Date.now(), spend: threadSpend(db, threadId), calls: 0 });
        setStatus(db, threadId, "working");
        pushThreads();
      },
      turnEnded({ durationMs, error }) {
        const turn = turns.get(threadId) ?? { at: Date.now(), spend: 0, calls: 0 };
        turns.delete(threadId);
        emit(threadId, {
          id: newId("turn"),
          at: now(),
          type: "turn",
          durationMs: durationMs || Date.now() - turn.at,
          calls: turn.calls,
          costUsd: threadSpend(db, threadId) - turn.spend,
        });
        if (error)
          emit(threadId, {
            id: newId("sys"),
            at: now(),
            type: "system",
            text: error === "interrupted" ? "Stopped" : `Ended: ${error}`,
          });
        // A question still open keeps the thread in Input instead of idle.
        setStatus(db, threadId, pendingQuestion(db, threadId) ? "input" : "idle");
        markUnread(db, threadId, true);
        // Changes from this turn already reviewed while it ran: nothing waits, so settle now.
        const started = new Date(turn.at).toISOString();
        const mine = threadProposals(db, threadId).filter((p) => p.createdAt >= started);
        if (mine.length > 0 && settleIfDone(db, threadId))
          emit(threadId, {
            id: newId("sys"),
            at: now(),
            type: "system",
            text: "Settled · nothing waits on you",
          });
        pushThreads();
      },
      requestApproval(ask) {
        const id = newId("apv");
        const event = {
          id,
          at: now(),
          type: "approval" as const,
          ...ask,
          status: "pending" as const,
        };
        emit(threadId, event);
        setStatus(db, threadId, "approval");
        pushThreads();
        return new Promise<boolean>((resolve) => {
          approvals.set(id, {
            threadId,
            resolve: (ok) => {
              approvals.delete(id);
              emit(threadId, { ...event, at: now(), status: ok ? "allowed" : "denied" });
              setStatus(db, threadId, "working");
              pushThreads();
              resolve(ok);
            },
          });
        });
      },
      closed: () => sessions.delete(threadId),
    };
  }

  function start(threadId: string, text: string) {
    const settings = getSettings(db);
    const hunt = getHunt(db);
    const session = provider.start({
      threadId,
      resumeId: sessionId(db, threadId),
      fork: sharesSession(db, threadId),
      firstText: text,
      systemPrompt: systemPrompt(
        hunt,
        profileFacts(db),
        settings,
        getApplicant(db),
        deps.signAs?.() ?? "",
      ),
      model: settings.model,
      tools: toolsFor(settings),
      askOver: settings.budget.askOver,
      mcpServers: settings.mcpServers,
      hooks: hooksFor(threadId),
      toolContext: {
        db,
        threadId,
        settings,
        hunt,
        sources,
        changed() {
          bus.push({ type: "changed", what: "proposals", threadId });
          pushThreads();
        },
        outreachChanged() {
          bus.push({ type: "changed", what: "outreach" });
          bus.push({ type: "changed", what: "records" });
        },
        vaultChanged: () => bus.push({ type: "changed", what: "vault" }),
        ask: (question) =>
          emit(threadId, {
            id: newId("ask"),
            at: now(),
            type: "question",
            text: question,
            status: "pending",
          }),
      },
    });
    sessions.set(threadId, session);
  }

  /** Sends a message to a thread. `shown` is what the transcript displays when it differs. */
  function send(
    threadId: string,
    text: string,
    delivery: "send" | "queued" | "steered",
    shown = text,
  ) {
    // The next message after a question is its answer.
    const asked = pendingQuestion(db, threadId);
    if (asked?.type === "question") emit(threadId, { ...asked, status: "answered" });
    emit(threadId, { id: newId("msg"), at: now(), type: "user", text: shown, delivery });
    if (getThread(db, threadId)?.settledAt) settle(db, threadId, false);
    const live = sessions.get(threadId);
    if (live)
      live.push(text, delivery === "steered" ? "now" : delivery === "queued" ? "next" : undefined);
    else start(threadId, text);
    pushThreads();
  }

  return {
    send,
    rowAction(threadId: string, op: RowOp, keys: string[]) {
      const rows = keys.flatMap((k) => {
        const r = getRecord(db, k);
        return r
          ? [
              `- ${r.name} | ${r.university} | key ${r.key} | email ${r.email || "?"} | site ${r.website || "?"} | contact ${r.contact || "?"}`,
            ]
          : [];
      });
      const prompt = `[row-action:${op}] keys=${keys.join(",")}\n${ROW_INSTRUCTIONS[op]}\n${rows.join("\n")}`;
      send(
        threadId,
        prompt,
        "send",
        `Row action: ${ROW_OPS[op].label} · ${keys.length} row${keys.length === 1 ? "" : "s"}`,
      );
    },
    async stop(threadId: string) {
      for (const a of approvals.values()) if (a.threadId === threadId) a.resolve(false);
      await sessions.get(threadId)?.interrupt();
    },
    resolveApproval(approvalId: string, ok: boolean) {
      approvals.get(approvalId)?.resolve(ok);
    },
    isLive: (threadId: string) => sessions.has(threadId),
  };
}

export type Runner = ReturnType<typeof createRunner>;
