import type { ThreadEvent } from "@gradcode/contracts";
import {
  BanIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  DollarSignIcon,
  GlobeIcon,
  LandmarkIcon,
  LoaderIcon,
  MessageCircleQuestionIcon,
  PencilIcon,
  SearchIcon,
  UserIcon,
  UsersIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { duration, plural, usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";

type Tool = Extract<ThreadEvent, { type: "tool" }>;
type Turn = Extract<ThreadEvent, { type: "turn" }>;
type Approval = Extract<ThreadEvent, { type: "approval" }>;

/** Consecutive tool calls become one work-log group; the turn that ends them labels it. */
export type Block =
  | { kind: "event"; event: Exclude<ThreadEvent, Tool | Turn | Approval> }
  | { kind: "work"; id: string; tools: Tool[]; turn: Turn | null }
  | { kind: "approval"; event: Approval };

export function toBlocks(events: ThreadEvent[]): Block[] {
  const out: Block[] = [];
  let work: Extract<Block, { kind: "work" }> | null = null;
  for (const e of events) {
    if (e.type === "tool") {
      if (!work) {
        work = { kind: "work", id: `work-${e.id}`, tools: [], turn: null };
        out.push(work);
      }
      work.tools.push(e);
    } else if (e.type === "turn") {
      if (work) work.turn = e;
      work = null;
    } else if (e.type === "approval") out.push({ kind: "approval", event: e });
    else {
      // The agent's words and questions belong to the turn; anything else starts a new block.
      if (e.type !== "assistant" && e.type !== "question") work = null;
      out.push({ kind: "event", event: e });
    }
  }
  return out;
}

function toolIcon(name: string) {
  if (name === "fetch") return <GlobeIcon />;
  if (name === "search") return <SearchIcon />;
  if (name.endsWith("_awards")) return <LandmarkIcon />;
  if (name === "openalex_author") return <UserIcon />;
  if (name === "sheet_search") return <UsersIcon />;
  if (name.startsWith("treg")) return <DollarSignIcon />;
  return <ZapIcon />;
}

function WorkLog({
  block,
  working,
}: {
  block: Extract<Block, { kind: "work" }>;
  working: boolean;
}) {
  const running = block.turn === null && working;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? running;
  const cost = block.turn?.costUsd ?? block.tools.reduce((n, t) => n + t.costUsd, 0);
  return (
    <div className="animate-fade-up">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        className="flex h-6 items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-secondary-label"
      >
        <ChevronRightIcon
          className={cn(
            "size-3 transition-transform duration-200 ease-drawer",
            expanded && "rotate-90",
          )}
        />
        {running ? "Working" : `Worked for ${duration(block.turn?.durationMs ?? 0)}`} ·{" "}
        {plural(block.tools.length, "call")}
        {cost > 0 ? ` · ${usd(cost)}` : ""}
      </button>
      {expanded ? (
        <div className="mt-0.5 ml-[7px] flex flex-col border-l pl-3.5">
          {block.tools.map((t) => (
            <div
              key={t.id}
              className="grid h-[26px] animate-fade-up grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 text-muted-foreground text-xs [&>svg]:size-3.5"
            >
              {t.status === "running" ? (
                <LoaderIcon className="text-status-working" />
              ) : t.status === "denied" ? (
                <BanIcon />
              ) : (
                toolIcon(t.name)
              )}
              <span className="truncate">
                <span className="text-secondary-label">{t.name}</span>{" "}
                <span className="font-mono text-2xs">{t.detail}</span>
              </span>
              <span
                className={cn(
                  "font-mono text-2xs",
                  t.status === "error" && "text-destructive-foreground",
                  t.status === "running" && "text-status-working",
                )}
              >
                {t.status === "running" ? "running" : t.meta || t.status}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A message waiting for the next tool call: steer it in now, edit, remove or move it until it goes out. */
function QueuedMessage({
  event,
  threadId,
}: {
  event: Extract<ThreadEvent, { type: "user" }>;
  threadId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(event.text);
  const edit = (next: string | null) =>
    void call("threads.editQueued", { threadId, eventId: event.id, text: next }).catch(() => {});
  const move = (by: -1 | 1) =>
    void call("threads.moveQueued", { threadId, eventId: event.id, by }).catch(() => {});
  return (
    <div className="flex animate-fade-up flex-col items-end gap-1" data-testid="queued">
      {editing ? (
        <div className="flex w-[86%] flex-col gap-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Edit queued message"
            rows={3}
            className="resize-none rounded-2xl border bg-accent px-3.5 py-2.5 text-sm outline-none"
          />
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost-muted" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              disabled={!text.trim()}
              onClick={() => {
                edit(text.trim());
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="max-w-[86%] whitespace-pre-wrap rounded-2xl border border-dashed bg-accent/60 px-3.5 py-2.5 text-sm leading-relaxed">
          {event.text}
        </div>
      )}
      <span className="flex items-center gap-1 pr-1 text-2xs text-muted-foreground">
        queued · after the current tool call
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() =>
            void call("threads.steerQueued", { threadId, eventId: event.id }).catch(() => {})
          }
        >
          Steer
        </Button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Move up"
          onClick={() => move(-1)}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Move down"
          onClick={() => move(1)}
        >
          <ChevronDownIcon />
        </Button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Edit queued message"
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </Button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Remove queued message"
          onClick={() => edit(null)}
        >
          <XIcon />
        </Button>
      </span>
    </div>
  );
}

/** A paid call waiting for the user, or a one-line record of how it was answered. */
export function ApprovalCard({ event, threadId }: { event: Approval; threadId: string }) {
  if (event.status !== "pending")
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {event.status === "allowed" ? (
          <CheckIcon className="size-3.5 text-success-foreground" />
        ) : (
          <XIcon className="size-3.5" />
        )}
        {event.status === "allowed" ? "Allowed" : "Denied"} · {event.body}
      </div>
    );
  const resolve = (decision: "once" | "always" | "deny") =>
    void call("approvals.resolve", { threadId, approvalId: event.id, decision });
  // "Always" allows paid calls up to the next cent above this one, in this thread (and its loop).
  const under = Math.max(0.01, Math.ceil(event.costUsd * 100) / 100);
  return (
    <div
      data-testid="approval"
      className="animate-fade-up rounded-2xl border border-warning/24 bg-warning/4 px-3.5 py-3"
    >
      <div className="flex items-center gap-2 font-medium text-warning-foreground text-xs">
        <CircleAlertIcon className="size-3.5" /> Approval · {event.title}
        <span className="ml-auto font-normal text-muted-foreground">over your ask limit</span>
      </div>
      <div className="mt-1.5 font-mono text-xs">{event.body}</div>
      {event.why ? <div className="mt-0.5 text-muted-foreground text-xs">{event.why}</div> : null}
      <div className="mt-2.5 flex justify-end gap-1.5">
        <Button variant="ghost-muted" size="xs" onClick={() => resolve("deny")}>
          Deny
        </Button>
        <Button variant="outline" size="xs" onClick={() => resolve("always")}>
          Always under ${under.toFixed(2)} here
        </Button>
        <Button size="xs" onClick={() => resolve("once")}>
          Allow once <Kbd className="bg-transparent text-primary-foreground/60">↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

export function Transcript({
  events,
  working,
  threadId,
}: {
  events: ThreadEvent[];
  working: boolean;
  threadId: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-4 pb-6">
      {toBlocks(events).map((b) => {
        if (b.kind === "work") return <WorkLog key={b.id} block={b} working={working} />;
        if (b.kind === "approval")
          return b.event.status === "pending" ? null : (
            <ApprovalCard key={b.event.id} event={b.event} threadId={threadId} />
          );
        const e = b.event;
        if (e.type === "user" && e.delivery === "queued")
          return <QueuedMessage key={e.id} event={e} threadId={threadId} />;
        if (e.type === "user")
          return (
            <div key={e.id} className="flex animate-fade-up flex-col items-end gap-1">
              <div className="max-w-[86%] whitespace-pre-wrap rounded-2xl bg-accent px-3.5 py-2.5 text-sm leading-relaxed">
                {e.text}
              </div>
              {e.attachments.length ? (
                <span className="pr-2 text-2xs text-muted-foreground">
                  attached {e.attachments.join(", ")}
                </span>
              ) : null}
              {e.delivery !== "send" ? (
                <span className="pr-2 text-2xs text-muted-foreground">
                  {e.delivery === "queued" ? "queued · after the current tool call" : "steered"}
                </span>
              ) : null}
            </div>
          );
        if (e.type === "question")
          return (
            <div
              key={e.id}
              data-testid="question"
              className="animate-fade-up rounded-2xl border border-status-input/30 px-3.5 py-3"
            >
              <div className="mb-1 flex items-center gap-1.5 font-medium text-status-input text-xs">
                <MessageCircleQuestionIcon className="size-3.5" />
                {e.status === "pending" ? "Input · waiting for your answer" : "Answered"}
              </div>
              <div className="text-sm">{e.text}</div>
            </div>
          );
        if (e.type === "assistant")
          return (
            <div key={e.id} className="animate-fade-up whitespace-pre-wrap text-sm leading-relaxed">
              {e.text}
            </div>
          );
        return (
          <div
            key={e.id}
            className="flex animate-fade-up items-center gap-2.5 text-muted-foreground text-xs before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
          >
            {e.text}
          </div>
        );
      })}
    </div>
  );
}
