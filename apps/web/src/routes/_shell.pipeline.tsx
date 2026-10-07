import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { ConversationView } from "~/components/Conversation";
import { Board, InboxList, MailLabel, SendQueue } from "~/components/Pipeline";
import { needsYou } from "~/lib/outreach";
import { useStore } from "~/state/store";

type Search = { view: "inbox" | "board"; key?: string };

export const Route = createFileRoute("/_shell/pipeline")({
  component: PipelinePage,
  validateSearch: (s: Record<string, unknown>): Search => ({
    view: s.view === "board" ? "board" : "inbox",
    ...(typeof s.key === "string" ? { key: s.key } : {}),
  }),
});

/** Outreach like a pipeline: Inbox by whose turn it is (default), or the Board by stage. */
function PipelinePage() {
  const { view, key } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const conversations = useStore((s) => s.conversations);
  const connected = useStore((s) => s.app?.mail.connected ?? false);
  const notice = useStore((s) => s.notice);
  const setNotice = useStore((s) => s.setNotice);
  const open = (k: string) => void navigate({ search: { view: "inbox", key: k } });
  const needYou = conversations.filter(needsYou).length;
  const selected =
    conversations.find((c) => c.record.key === key) ??
    conversations.find((c) => c.turn !== "closed");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="font-semibold text-sm">Pipeline</h1>
        <ToggleGroup
          value={[view]}
          onValueChange={(v) => {
            const next = v[0] === "board" ? "board" : v[0] === "inbox" ? "inbox" : view;
            void navigate({ search: { view: next, ...(key ? { key } : {}) } });
          }}
        >
          <Toggle value="board" size="xs">
            Board
          </Toggle>
          <Toggle value="inbox" size="xs">
            Inbox
          </Toggle>
        </ToggleGroup>
        <span className="text-muted-foreground text-xs tabular-nums">
          {conversations.length} professors · {needYou} need you
        </span>
        {notice ? (
          <span className="flex min-w-0 items-center gap-1 text-destructive-foreground text-xs">
            <span className="truncate">{notice}</span>
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
            >
              <XIcon />
            </Button>
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-3">
          <MailLabel />
          <SendQueue conversations={conversations} />
        </span>
      </header>
      {conversations.length === 0 ? (
        <div className="m-auto max-w-sm text-center text-muted-foreground text-xs">
          Nothing in the pipeline yet. In a thread's Results, select rows and choose Draft first
          emails.
        </div>
      ) : view === "board" ? (
        <Board conversations={conversations} onOpen={open} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <InboxList
            conversations={conversations}
            selected={selected?.record.key}
            onSelect={open}
          />
          {selected ? <ConversationView c={selected} connected={connected} /> : <div />}
        </div>
      )}
    </div>
  );
}
