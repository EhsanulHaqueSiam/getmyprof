import type { Channel, Conversation, OutreachMessage } from "@gradcode/contracts";
import { draftIssues, PIPELINE_STAGES } from "@gradcode/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { ago, since } from "~/lib/format";
import {
  cardLine,
  openDraft,
  preview,
  STAGE_LABEL,
  theirTime,
  TURN_LABEL,
  TURN_ORDER,
} from "~/lib/outreach";
import { useMinuteClock } from "~/lib/useMinuteClock";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/** "M" for mail, "in" for LinkedIn, as in the mock. */
export function ChannelBadge({ channel }: { channel: Channel }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded border px-1 font-mono font-semibold text-3xs",
        channel === "linkedin"
          ? "border-info/40 text-info-foreground"
          : "border-input text-secondary-label",
      )}
    >
      {channel === "linkedin" ? "in" : "M"}
    </span>
  );
}

export const TOUCH_LABEL: Record<NonNullable<OutreachMessage["touch"]>, string> = {
  first: "first email",
  "follow-up-1": "follow-up 1",
  "follow-up-2": "follow-up 2",
  reply: "answer",
  "after-applying": "after applying",
  "thank-you": "thank-you",
};

/** Runs an action; a refusal from the server shows in the Pipeline header. */
export const act = (work: Promise<unknown>) =>
  void work.catch((e: unknown) =>
    useStore.getState().setNotice(e instanceof Error ? e.message : String(e)),
  );

/** Inbox list: everyone grouped by whose move it is. */
export function InboxList({
  conversations,
  selected,
  onSelect,
  connected,
}: {
  /** Approving needs a mailbox; without one, drafts go out through the user's mail app. */
  connected: boolean;
  conversations: Conversation[];
  selected: string | undefined;
  onSelect: (key: string) => void;
}) {
  const app = useStore((s) => s.app);
  // "Approve a day": as many as today's warm-up lets go out.
  const cap = app?.mail.dailyCap ?? 0;
  // A draft with an issue (unproven claim, unchecked address...) waits for a fix, not approval.
  const needsFix = (c: Conversation) => {
    const d = openDraft(c);
    return (
      !!d &&
      draftIssues(d, {
        facts: app?.facts ?? [],
        applicant: app?.applicant,
        emailCheck: c.record.emailCheck,
      }).length > 0
    );
  };
  return (
    <div className="min-h-0 overflow-y-auto border-r px-1.5 pb-3">
      {TURN_ORDER.map((turn) => {
        const items = conversations.filter((c) => c.turn === turn);
        if (items.length === 0) return null;
        const drafts = items.flatMap((c) => openDraft(c) ?? []);
        const ready = items.flatMap((c) => (needsFix(c) ? [] : (openDraft(c) ?? [])));
        return (
          <div key={turn} data-testid={`turn-${turn}`}>
            <div className="flex h-8 items-center gap-1.5 px-2 pt-2 text-muted-foreground text-xs">
              {TURN_LABEL[turn]} · {items.length}
              {turn === "approve" && ready.length > cap && cap > 0 && connected ? (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  className="ml-auto"
                  onClick={() =>
                    act(call("outreach.approve", { ids: ready.slice(0, cap).map((d) => d.id) }))
                  }
                >
                  Approve a day ({cap})
                </Button>
              ) : null}
              {turn === "approve" && ready.length > 1 && connected ? (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  className={ready.length > cap && cap > 0 ? undefined : "ml-auto"}
                  onClick={() => act(call("outreach.approve", { ids: ready.map((d) => d.id) }))}
                >
                  {ready.length === drafts.length ? "Approve all" : `Approve ${ready.length} ready`}
                </Button>
              ) : null}
            </div>
            {items.map((c) => {
              const channel = c.messages.at(-1)?.channel ?? "email";
              return (
                <button
                  key={c.record.key}
                  type="button"
                  onClick={() => onSelect(c.record.key)}
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent",
                    selected === c.record.key && "bg-secondary",
                  )}
                >
                  <span className="truncate font-medium text-sm">{c.record.name}</span>
                  <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <ChannelBadge channel={channel} />
                    {ago(c.lastAt)}
                  </span>
                  <span className="col-span-2 truncate text-secondary-label text-xs">
                    {turn === "approve" && needsFix(c) ? (
                      <span className="text-warning-foreground">needs a fix · </span>
                    ) : null}
                    {preview(c)}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Board: every professor as a card in their stage. Cards open in the Inbox. */
export function Board({
  conversations,
  onOpen,
}: {
  conversations: Conversation[];
  onOpen: (key: string) => void;
}) {
  // A call with this professor (an interview on an application) and whether its prep pack is
  // written, so the Call card says when and whether you're ready.
  const vault = useStore((st) => st.vault);
  const callLine = (name: string) => {
    const last = name.split(" ").at(-1)?.toLowerCase() ?? "";
    for (const app of vault?.applications ?? [])
      for (const i of app.interviews)
        if (last && i.with.toLowerCase().includes(last)) {
          const prep = vault?.writing.some(
            (w) => w.kind === "prep" && w.programId === app.programId && w.title.endsWith(i.with),
          );
          const at = new Date(i.at).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          return `Call ${at} · ${prep ? "prep pack ready" : "no prep pack yet"}`;
        }
    return "";
  };
  return (
    <div className="grid min-h-0 flex-1 auto-cols-[minmax(176px,1fr)] grid-flow-col gap-px overflow-x-auto bg-border">
      {PIPELINE_STAGES.map((stage) => {
        const cards = conversations.filter((c) => c.stage === stage);
        return (
          <div key={stage} className="flex min-h-0 min-w-44 flex-col bg-background">
            <div className="flex h-9 shrink-0 items-center gap-1.5 px-3 text-muted-foreground text-xs">
              {STAGE_LABEL[stage]}
              <span className="text-secondary-label tabular-nums">{cards.length}</span>
            </div>
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
              {cards.map((c) => (
                <button
                  key={c.record.key}
                  type="button"
                  data-testid="card"
                  onClick={() => onOpen(c.record.key)}
                  className={cn(
                    "rounded-xl border px-2.5 py-2 text-left transition-colors hover:bg-accent",
                    c.turn === "yours" && "border-status-input/40",
                    c.turn === "follow-up" && "border-status-approval/40",
                  )}
                >
                  <div className="flex items-center gap-1.5 font-medium text-sm">
                    <span className="truncate">{c.record.name}</span>
                    {[...new Set(c.messages.map((m) => m.channel))].map((ch) => (
                      <ChannelBadge key={ch} channel={ch} />
                    ))}
                  </div>
                  <div className="truncate text-muted-foreground text-xs">
                    {[
                      c.record.university,
                      `fit ${c.record.fit}`,
                      c.record.moneyTier ? `tier ${c.record.moneyTier}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="mt-1.5 text-secondary-label text-xs">{cardLine(c)}</div>
                  {callLine(c.record.name) ? (
                    <div className="mt-1 text-status-input text-xs" data-testid="call-line">
                      {callLine(c.record.name)}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Everything scheduled, soonest first, with the time it lands for the professor. */
export function SendQueue({ conversations }: { conversations: Conversation[] }) {
  const [open, setOpen] = useState(false);
  const queued = conversations
    .flatMap((c) =>
      c.messages.filter((m) => m.status === "scheduled").map((m) => ({ m, name: c.record.name })),
    )
    .toSorted((a, b) => (a.m.scheduledAt ?? "").localeCompare(b.m.scheduledAt ?? ""));
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Send queue <span className="tabular-nums">{queued.length}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-xl p-4">
          <DialogTitle className="text-sm">Send queue</DialogTitle>
          <div className="mt-3 flex flex-col">
            {queued.map(({ m, name }) => (
              <div
                key={m.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChannelBadge channel={m.channel} />
                  <span className="truncate">{name}</span>
                  <span className="truncate text-muted-foreground text-xs">{m.subject}</span>
                </span>
                <span className="flex gap-1">
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    onClick={() => act(call("outreach.cancel", { id: m.id }))}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => act(call("outreach.sendNow", { id: m.id }))}
                  >
                    Send now
                  </Button>
                </span>
                <span className="col-span-2 text-muted-foreground text-xs">
                  {m.channel === "linkedin" ? "send it on LinkedIn, then mark sent" : theirTime(m)}
                </span>
              </div>
            ))}
            {queued.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-xs">Nothing queued.</div>
            ) : null}
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}

/** "mail synced 2m ago" (click to sync now), or the way to connect a mailbox. */
export function MailLabel() {
  const mail = useStore((s) => s.app?.mail);
  const now = useMinuteClock();
  if (!mail?.connected)
    return (
      <Link
        to="/settings"
        className="shrink-0 text-info-foreground text-xs whitespace-nowrap underline"
      >
        Connect a mailbox
      </Link>
    );
  return (
    <button
      type="button"
      title="Sync now"
      onClick={() => act(call("mail.sync", {}))}
      className={cn(
        "text-xs transition-colors hover:text-foreground",
        mail.error ? "text-destructive-foreground" : "text-muted-foreground",
      )}
    >
      {mail.error
        ? `mail sync failed: ${mail.error}`
        : `mail synced ${since(mail.lastSyncAt, now)}`}
    </button>
  );
}
