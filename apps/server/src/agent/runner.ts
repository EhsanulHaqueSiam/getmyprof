import { ROW_OPS, type RowOp, type ThreadEvent } from "@getmyprof/contracts";
import type { Bus } from "../bus.ts";
import { type Db, newId, now } from "../db.ts";
import { getRecord, recordLine, threadProposals } from "../records.ts";
import { profileFacts } from "../adapters.ts";
import { getApplicant, getHunt, getSettings } from "../state.ts";
import { allowLoopUnder, listLoops, noteRun } from "../loops.ts";
import { listSchools } from "../vault.ts";
import {
  allowUnder,
  setAllowUnder,
  listThreads,
  markUnread,
  putEvent,
  sessionId,
  setSession,
  setStatus,
  settle,
  settleIfDone,
  getThread,
  deleteEvent,
  listEvents,
  pendingQuestion,
  sharesSession,
  threadSpend,
} from "../threads.ts";
import { systemPrompt } from "./prompt.ts";
import type { AgentProvider, AgentSession, Attachment, SessionHooks } from "./provider.ts";
import { type Sources, toolsFor } from "./tools.ts";

const ROW_INSTRUCTIONS: Record<RowOp, string> = {
  email:
    "Find and check the email address of each professor below. Look for it on an official page first. If treg is available: only when no official page lists one, find it with treg.people.email.find, then verify each address with treg.people.email.verify (usually free). Pass the professor's sheet key as `about` on every treg call. Record email and emailCheck for each with propose_professor.",
  lasts:
    "For each professor below, look up their active NSF and NIH awards and record money and how long it lasts after the intake (lasts) with propose_professor.",
  taking:
    "For each professor below, read their homepage or lab page and record whether they're taking students for the intake (taking) and how they want to be reached (contact) with propose_professor.",
  work: 'For each professor below, look them up with openalex_author, then read their homepage or lab page (and their Google Scholar page when OpenAlex is thin), and record with propose_professor: recent (their latest two or three papers or projects, newest first, each dated), niche (their area and current topics), seeking (what they want students to work on or bring, in their words, or "not stated") and scholar (their Google Scholar profile URL, when their page or CSRankings links it).',
  draft:
    "Draft a short first message for each professor below with draft_email (touch first). Email goes only to a reviewed address. Without one, if the sheet has their LinkedIn profile, draft a LinkedIn note instead (channel linkedin, to that URL, under 200 characters so it also fits a connection request). Skip apply-only professors and anyone with neither, and say so. The applicant approves each draft in Pipeline before anything is sent.",
};

/** A loop run in a line: "2 new, 1 change, 1 accepted", why it stopped, or "nothing new". */
export function runSummary(
  proposals: { kind: "add" | "update"; status: string }[],
  stop: string | null,
) {
  const n = (k: "add" | "update") => proposals.filter((p) => p.kind === k).length;
  const accepted = proposals.filter((p) => p.status === "accepted").length;
  const found = [
    n("add") ? `${n("add")} new` : "",
    n("update") ? `${n("update")} change${n("update") === 1 ? "" : "s"}` : "",
    accepted ? `${accepted} accepted` : "",
  ].filter(Boolean);
  if (stop && stop !== "interrupted") return [stop, ...found].join(" · ");
  return found.length ? found.join(", ") : "nothing new";
}

const RESTARTED = "The server restarted mid-turn · picking up where it left off";

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
  const approvals = new Map<
    string,
    { threadId: string; costUsd: number; resolve: (ok: boolean) => void }
  >();
  const turns = new Map<string, { at: number; spend: number; calls: number }>();

  /** The treg feature tag of each thread's latest message: row-<op> for a row action. */
  const features = new Map<string, string>();
  /** Threads whose latest message is an Ask: read-only and free. */
  const asks = new Set<string>();

  /** Queued messages held until the next tool call ends, editable and reorderable until then. */
  const held = new Map<string, { eventId: string; text: string; files: Attachment[] }[]>();

  const pushThreads = () => bus.push({ type: "threads", threads: listThreads(db) });
  const reloadThread = (threadId: string) =>
    bus.push({ type: "changed", what: "thread", threadId });

  function emit(threadId: string, event: ThreadEvent) {
    putEvent(db, threadId, event);
    bus.push({ type: "event", threadId, event });
    const turn = turns.get(threadId);
    if (turn && event.type === "tool" && event.status !== "running") turn.calls++;
    if (event.type === "tool" && event.status !== "running") flush(threadId, "next");
  }

  /** Hands held messages to the session: after a tool call ("next"), or as the next turn. */
  function flush(threadId: string, priority: "next" | undefined) {
    const queue = held.get(threadId);
    const live = sessions.get(threadId);
    if (!queue?.length || !live) return;
    held.delete(threadId);
    const events = listEvents(db, threadId);
    for (const m of queue) {
      live.push(m.text, priority, m.files);
      const e = events.find((x) => x.id === m.eventId);
      if (e?.type === "user") emit(threadId, { ...e, delivery: "send" });
    }
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
        // Messages still held when a turn ends become the next turn; a stopped turn dropped them.
        flush(threadId, undefined);
        if (mine.length > 0 && settleIfDone(db, threadId))
          emit(threadId, {
            id: newId("sys"),
            at: now(),
            type: "system",
            text: "Settled · nothing waits on you",
          });
        // A loop run leaves its Last run line: what it found, or why it stopped.
        const loopId = getThread(db, threadId)?.loopId;
        if (loopId) {
          const stop = listEvents(db, threadId).findLast(
            (e) => e.type === "system" && e.at >= started && e.text.startsWith("Stopped:"),
          );
          noteRun(db, loopId, runSummary(mine, stop?.type === "system" ? stop.text : error));
          bus.push({ type: "changed", what: "loops" });
        }
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
            costUsd: ask.costUsd,
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

  /** What a paid call may cost here without asking: the install's limit, or a rule set here. */
  function allowance(threadId: string) {
    const loopId = getThread(db, threadId)?.loopId;
    const loop = loopId ? listLoops(db).find((l) => l.id === loopId) : undefined;
    return Math.max(
      getSettings(db).budget.askOver,
      allowUnder(db, threadId),
      loop?.allowUnder ?? 0,
    );
  }

  function start(threadId: string, text: string, files: Attachment[]) {
    const install = getSettings(db);
    // A thread may dig deeper or lighter than the install.
    const settings = { ...install, detail: getThread(db, threadId)?.detail ?? install.detail };
    const hunt = getHunt(db);
    const session = provider.start({
      threadId,
      resumeId: sessionId(db, threadId),
      fork: sharesSession(db, threadId),
      firstText: text,
      firstFiles: files,
      systemPrompt: systemPrompt(
        hunt,
        profileFacts(db),
        settings,
        getApplicant(db),
        deps.signAs?.() ?? "",
        listSchools(db),
      ),
      model: settings.model,
      tools: toolsFor(settings),
      askOver: () => allowance(threadId),
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
        feature: () =>
          features.get(threadId) ?? (getThread(db, threadId)?.loopId ? "loop" : "hunt"),
        spent: () => bus.push({ type: "changed", what: "state" }),
        askOnly: () => asks.has(threadId),
        capHit(reason) {
          // A thread keeps going on free sources; a loop run ends at its cap and says why.
          if (!getThread(db, threadId)?.loopId) return;
          emit(threadId, {
            id: newId("cap"),
            at: now(),
            type: "system",
            text: `Stopped: ${reason}`,
          });
          setTimeout(() => void sessions.get(threadId)?.interrupt());
        },
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
    files: Attachment[] = [],
  ) {
    // "[ask] ..." from the composer: answer only, change nothing, spend nothing.
    const ask = /^\[ask\]\s*/.exec(text);
    if (ask) {
      asks.add(threadId);
      // What was typed, not what rides along for the agent (a scope note, say).
      shown = `Ask · ${shown.replace(/^\[ask\]\s*/, "")}`;
      text = `${text}\n\n(Ask mode: answer from what you can read. Change nothing, propose nothing, spend nothing.)`;
    } else asks.delete(threadId);
    const op = /^\[row-action:(\w+)\]/.exec(text)?.[1];
    if (op) features.set(threadId, `row-${op}`);
    else features.delete(threadId);
    // The next message after a question is its answer.
    const asked = pendingQuestion(db, threadId);
    if (asked?.type === "question") emit(threadId, { ...asked, status: "answered" });
    const eventId = newId("msg");
    emit(threadId, {
      id: eventId,
      at: now(),
      type: "user",
      text: shown,
      delivery,
      attachments: files.map((f) => f.name),
    });
    const status = getThread(db, threadId)?.status;
    if (getThread(db, threadId)?.settledAt) settle(db, threadId, false);
    const live = sessions.get(threadId);
    const busy = status === "working" || status === "approval";
    if (live && delivery === "queued" && busy)
      held.set(threadId, [...(held.get(threadId) ?? []), { eventId, text, files }]);
    else if (live) live.push(text, delivery === "steered" ? "now" : undefined, files);
    else start(threadId, text, files);
    pushThreads();
  }

  /** Changes or removes (text null) a message still held in the queue. False once it went out. */
  function editQueued(threadId: string, eventId: string, text: string | null) {
    const queue = held.get(threadId) ?? [];
    const i = queue.findIndex((m) => m.eventId === eventId);
    const e = listEvents(db, threadId).find((x) => x.id === eventId);
    if (i < 0 || e?.type !== "user") return false;
    if (text === null) {
      queue.splice(i, 1);
      deleteEvent(db, threadId, eventId);
      reloadThread(threadId);
    } else {
      queue[i] = { eventId, text, files: queue[i]?.files ?? [] };
      emit(threadId, { ...e, text });
    }
    return true;
  }

  /** Sends a held message now, mid-turn, instead of after the current tool call. */
  function steerQueued(threadId: string, eventId: string) {
    const queue = held.get(threadId) ?? [];
    const i = queue.findIndex((m) => m.eventId === eventId);
    const live = sessions.get(threadId);
    const m = queue[i];
    if (!m || !live) return false;
    queue.splice(i, 1);
    live.push(m.text, "now", m.files);
    const e = listEvents(db, threadId).find((x) => x.id === eventId);
    if (e?.type === "user") emit(threadId, { ...e, delivery: "steered" });
    return true;
  }

  /** Moves a held message one place earlier (-1) or later (+1); the transcript follows. */
  function moveQueued(threadId: string, eventId: string, by: -1 | 1) {
    const queue = held.get(threadId) ?? [];
    const i = queue.findIndex((m) => m.eventId === eventId);
    const j = i + by;
    const a = queue[i];
    const b = queue[j];
    if (!a || !b) return false;
    queue[i] = b;
    queue[j] = a;
    // Re-append the held messages in their new order, so the transcript reads the same way.
    const events = listEvents(db, threadId);
    for (const m of queue) {
      const e = events.find((x) => x.id === m.eventId);
      if (!e) continue;
      deleteEvent(db, threadId, e.id);
      putEvent(db, threadId, e);
    }
    reloadThread(threadId);
    return true;
  }

  /**
   * After a restart: approvals and tool calls the old process was waiting on lapse, and a turn it
   * was running picks up where it stopped, its session resumed with a note. A thread cut off
   * again right after resuming is left idle, so a crash can't loop. A question still waits.
   */
  function resumeAfterRestart() {
    for (const t of listThreads(db)) {
      const events = listEvents(db, t.id);
      for (const e of events) {
        if (e.type === "approval" && e.status === "pending")
          putEvent(db, t.id, { ...e, status: "denied" });
        if (e.type === "tool" && e.status === "running")
          putEvent(db, t.id, { ...e, status: "error", meta: "server restarted" });
      }
      if (t.status === "idle") continue;
      const last = events.at(-1);
      const cutOff = t.status === "working" || t.status === "approval";
      if (!cutOff || !sessionId(db, t.id) || (last?.type === "system" && last.text === RESTARTED)) {
        setStatus(db, t.id, pendingQuestion(db, t.id) ? "input" : "idle");
        continue;
      }
      emit(t.id, { id: newId("sys"), at: now(), type: "system", text: RESTARTED });
      // An Ask stays read-only and free across the restart.
      const asked = events.findLast((e) => e.type === "user")?.text.startsWith("Ask · ");
      if (asked) asks.add(t.id);
      start(
        t.id,
        `The server restarted during your last turn. Pick up where you left off; what you already proposed or drafted is saved.${asked ? "\n\n(Ask mode: answer from what you can read. Change nothing, propose nothing, spend nothing.)" : ""}`,
        [],
      );
    }
    pushThreads();
  }

  return {
    send,
    resumeAfterRestart,
    editQueued,
    steerQueued,
    moveQueued,
    rowAction(threadId: string, op: RowOp, keys: string[]) {
      const rows = keys.flatMap((k) => {
        const r = getRecord(db, k);
        return r ? [recordLine(r)] : [];
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
      // Stop means stop: messages still waiting in the queue go away instead of starting a turn.
      for (const m of held.get(threadId) ?? []) deleteEvent(db, threadId, m.eventId);
      if (held.delete(threadId)) reloadThread(threadId);
      await sessions.get(threadId)?.interrupt();
    },
    /** once allows this call; always also allows any call up to the next cent above it, here. */
    resolveApproval(approvalId: string, decision: "once" | "always" | "deny") {
      const a = approvals.get(approvalId);
      if (!a) return;
      if (decision === "always") {
        const under = Math.max(0.01, Math.ceil(a.costUsd * 100) / 100);
        setAllowUnder(db, a.threadId, under);
        const loopId = getThread(db, a.threadId)?.loopId;
        if (loopId) allowLoopUnder(db, loopId, under);
      }
      a.resolve(decision !== "deny");
    },
    isLive: (threadId: string) => sessions.has(threadId),
  };
}

export type Runner = ReturnType<typeof createRunner>;
