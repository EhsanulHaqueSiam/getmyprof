// What the Pipeline shows about a conversation: labels, the sequence and the one next step.
// Pure, from the server's derived Conversation, so Inbox and Board agree.
import type { Conversation, OutreachMessage, PipelineStage, Turn } from "@gradcode/contracts";

export const TURN_LABEL: Record<Turn, string> = {
  yours: "Your turn",
  "follow-up": "Follow-up due",
  approve: "To approve",
  queued: "Queued",
  theirs: "Their turn",
  closed: "Closed",
};
export const TURN_ORDER: Turn[] = ["yours", "follow-up", "approve", "queued", "theirs", "closed"];

/** Conversations the sidebar counts: the next move is the user's. */
export const needsYou = (c: Conversation) =>
  c.turn === "yours" || c.turn === "follow-up" || c.turn === "approve";

export const STAGE_LABEL: Record<PipelineStage, string> = {
  "to-contact": "To contact",
  contacted: "Contacted",
  "follow-up": "Follow-up due",
  replied: "Replied",
  call: "Call",
  closed: "Closed",
};

/** The professor's zone, from the mail drafted to them. Pipeline dates all read in it. */
export const zoneOf = (c: Conversation) =>
  c.messages.find((m) => m.direction === "out" && m.timeZone)?.timeZone || undefined;

const day = (iso: string, timeZone: string | undefined) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });

/** "Tue, Oct 13, 8:00 AM their time": when a scheduled message lands for the professor. */
export const theirTime = (m: Pick<OutreachMessage, "scheduledAt" | "at" | "timeZone">) => {
  const iso = m.scheduledAt ?? m.at;
  if (!iso) return "";
  return `${new Date(iso).toLocaleString("en-US", {
    timeZone: m.timeZone || undefined,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} their time`;
};

const out = (c: Conversation) => c.messages.filter((m) => m.direction === "out");
/** The draft waiting on the user, if any: an answer first, then anything else. */
export const openDraft = (c: Conversation) => {
  const waiting = out(c).filter((m) => m.status === "draft" || m.status === "failed");
  return waiting.find((m) => m.touch === "reply") ?? waiting[0] ?? null;
};
const lastReply = (c: Conversation) =>
  c.messages.findLast((m) => m.direction === "in" && (m.kind === "reply" || m.kind === "linkedin"));

/** One line for a list row: the latest message, as the user would scan it. */
export function preview(c: Conversation) {
  const draft = openDraft(c);
  if (draft) return `Draft: ${draft.body.replace(/\s+/g, " ").trim()}`;
  const shown = c.messages.filter((m) => m.status !== "cancelled");
  const last = shown.at(-1);
  if (!last) return c.record.niche || "no messages yet";
  const text = last.body.replace(/\s+/g, " ").trim();
  if (last.direction === "in") return text;
  if (last.status === "draft") return `Draft: ${text}`;
  if (last.status === "scheduled") return `Queued: ${text}`;
  if (last.status === "failed") return `Not sent: ${last.note}`;
  return `You: ${text}`;
}

/** The status line a Board card shows under the name. */
export function cardLine(c: Conversation) {
  const zone = zoneOf(c);
  const draft = openDraft(c);
  const reply = lastReply(c);
  const first = out(c).find((m) => m.touch === "first" && m.status === "sent");
  switch (c.stage) {
    case "to-contact":
      return c.stopped === "bounced"
        ? "bounced · needs another address"
        : draft
          ? "draft ready"
          : out(c).some((m) => m.status === "scheduled")
            ? "queued to send"
            : "needs a draft";
    case "contacted":
      return [
        first?.at ? `sent ${day(first.at, zone)}` : "sent outside gradcode",
        c.messages.findLast((m) => m.kind === "auto-reply")?.note ?? "",
        c.followUpAt ? `follow-up ${day(c.followUpAt, zone)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "follow-up":
      return draft ? "follow-up ready to approve" : "follow-up due";
    case "replied":
    case "call":
      return c.turn === "yours"
        ? `your turn${reply?.note ? ` · ${reply.note}` : ""}`
        : (reply?.note ?? "answered");
    case "closed":
      return c.stopped ?? "closed";
  }
}

/** What happens next, in one sentence. */
export function nextStep(c: Conversation) {
  const zone = zoneOf(c);
  const draft = openDraft(c);
  const queued = out(c).find((m) => m.status === "scheduled");
  if (c.turn === "closed") return `Closed: ${c.stopped ?? "nothing more to do"}.`;
  if (c.stopped === "bounced") return "The address bounced. Find another one before writing again.";
  if (c.turn === "yours")
    return draft ? "Read their message, then send the drafted answer." : "Answer them.";
  if (c.turn === "follow-up")
    return draft
      ? "Approve the follow-up; it goes out in the next slot."
      : "A follow-up is due; the agent drafts it.";
  if (c.turn === "approve") return "Approve the draft to give it a send slot, or send it now.";
  if (queued) return `Goes out ${theirTime(queued)}.`;
  if (c.followUpAt) return `Follow-up on ${day(c.followUpAt, zone)} if they don't answer.`;
  return "Waiting on them.";
}

export type Step = {
  id: string;
  label: string;
  when: string;
  state: "done" | "now" | "later" | "off";
};

/** The sequence beside a conversation: what went out, what came back, and what's planned. */
export function sequence(c: Conversation): Step[] {
  const zone = zoneOf(c);
  const steps: Step[] = [];
  for (const m of c.messages) {
    if (m.status === "cancelled") continue;
    if (m.direction === "in") {
      const label =
        m.kind === "bounce"
          ? "Bounced"
          : m.kind === "auto-reply"
            ? "Out of office"
            : m.channel === "linkedin"
              ? "LinkedIn reply"
              : "Reply received";
      steps.push({ id: m.id, label, when: m.at ? day(m.at, zone) : "", state: "done" });
      continue;
    }
    const label =
      m.touch === "first"
        ? m.channel === "linkedin"
          ? "LinkedIn note"
          : "First email"
        : m.touch === "reply"
          ? "Answer"
          : m.touch === "follow-up-1"
            ? "Follow-up 1"
            : m.touch === "follow-up-2"
              ? "Follow-up 2"
              : "After applying";
    const id = m.id;
    if (m.status === "sent")
      steps.push({ id, label, when: m.at ? day(m.at, zone) : "", state: "done" });
    else if (m.status === "scheduled")
      steps.push({
        id,
        label,
        when: m.scheduledAt ? day(m.scheduledAt, zone) : "",
        state: "later",
      });
    else
      steps.push({ id, label, when: m.status === "failed" ? "not sent" : "draft", state: "now" });
  }
  const sentFollowUps = out(c).filter(
    (m) => m.touch?.startsWith("follow-up") && m.status !== "cancelled",
  ).length;
  const contacted = out(c).some((m) => m.touch === "first" && m.status === "sent");
  for (const n of [1, 2].slice(sentFollowUps)) {
    if (!contacted) break;
    if (c.stopped) {
      steps.push({
        id: `plan-${n}`,
        label: `Follow-up ${n}`,
        when: `paused: ${c.stopped}`,
        state: "off",
      });
      break;
    }
    const due = n === sentFollowUps + 1 && c.followUpAt;
    steps.push({
      id: `plan-${n}`,
      label: `Follow-up ${n}`,
      when: due ? day(c.followUpAt ?? "", zone) : "later",
      state: due && c.turn === "follow-up" ? "now" : "later",
    });
  }
  return steps;
}
