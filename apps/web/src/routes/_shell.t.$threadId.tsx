import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GitBranchIcon, PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ApprovalCard, Transcript } from "~/components/Chat";
import { Composer } from "~/components/Composer";
import { Results } from "~/components/Results";
import { Review } from "~/components/Review";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/t/$threadId")({ component: ThreadPage });

function ThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const view = useStore((s) => s.views[threadId]);
  const loadView = useStore((s) => s.loadView);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const perThread = useStore((s) => s.app?.settings.budget.perThread ?? 0.5);
  // What this thread left elsewhere: drafts waiting in the Pipeline, finds waiting in To file.
  const drafts = useStore(
    (s) =>
      s.conversations
        .flatMap((c) => c.messages)
        .filter((m) => m.threadId === threadId && m.status === "draft").length,
  );
  const finds = useStore((s) => s.vault?.toFile.filter((f) => f.threadId === threadId).length ?? 0);
  const findsIn = useStore((s) => s.vault?.toFile.find((f) => f.threadId === threadId)?.kind);
  const [mode, setMode] = useState<"chat" | "results">("chat");
  const [panel, setPanel] = useState(true);
  const status = view?.thread.status;

  useEffect(() => {
    void loadView(threadId);
  }, [threadId, loadView]);
  // Reading a thread clears its unread dot, including a turn that finishes while it's open.
  useEffect(() => {
    if (status === "idle") void call("threads.visit", { id: threadId });
  }, [threadId, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setMode((m) => (m === "chat" ? "results" : "chat"));
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        setPanel((p) => !p);
      }
      const typing =
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, [contenteditable]") !== null;
      if (!mod && !typing && e.key === "e")
        void call("threads.settle", { id: threadId, settled: true });
      const first = view?.proposals.find((p) => p.status === "pending");
      if (!mod && !typing && first && (e.key === "a" || e.key === "r"))
        void call("proposals.resolve", {
          ids: [first.id],
          decision: e.key === "a" ? "accept" : "reject",
        });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadId, view]);

  if (!view) return <div className="flex-1" />;
  // Waiting on the applicant (Input) or nothing at all counts as not working.
  const working = status === "working" || status === "approval";
  const pendingApproval = view.events.find((e) => e.type === "approval" && e.status === "pending");
  const reviewCount = view.proposals.filter((p) => p.status === "pending").length;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 pr-2.5 pl-4">
        {!sidebarOpen ? (
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Show sidebar"
            onClick={toggleSidebar}
          >
            <PanelLeftIcon />
          </Button>
        ) : null}
        <h1 className="truncate font-semibold text-sm">{view.thread.title}</h1>
        <div className="inline-flex shrink-0 rounded-lg border p-0.5 text-xs" role="tablist">
          {(["chat", "results"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-6 rounded-md px-2.5 transition-colors",
                mode === m
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "chat" ? "Chat" : "Results"}
              {m === "results" ? (
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {view.thread.rows}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-muted-foreground text-xs">
          {usd(view.thread.spendUsd) === "free" ? "$0" : usd(view.thread.spendUsd)} / $
          {perThread.toFixed(2)}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-sm"
                aria-label="Fork thread"
                onClick={async () => {
                  const copy = await call("threads.fork", { id: threadId });
                  void navigate({ to: "/t/$threadId", params: { threadId: copy.id } });
                }}
              />
            }
          >
            <GitBranchIcon />
          </TooltipTrigger>
          <TooltipPopup>Fork: branch from here, the original stays as it is</TooltipPopup>
        </Tooltip>
        {mode === "chat" ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  aria-label="Toggle panel"
                  onClick={() => setPanel(!panel)}
                />
              }
            >
              <PanelRightIcon />
            </TooltipTrigger>
            <TooltipPopup>
              Review panel <Kbd>⌘\</Kbd>
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </header>

      {mode === "results" ? (
        <Results view={view} threadId={threadId} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2">
              <Transcript events={view.events} working={working} threadId={threadId} />
            </div>
            <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-2 px-6 pb-4">
              {pendingApproval?.type === "approval" ? (
                <ApprovalCard event={pendingApproval} threadId={threadId} />
              ) : null}
              <Composer
                autoFocus
                working={working}
                placeholder={
                  view.thread.status === "input"
                    ? "Answer the question above."
                    : "Ask anything, or tell it what to find next."
                }
                onSend={(text, delivery, attachments) =>
                  void call("threads.send", { id: threadId, text, delivery, attachments })
                }
                onStop={() => void call("threads.stop", { id: threadId })}
              />
            </div>
          </div>
          <aside
            className={cn(
              "flex shrink-0 flex-col overflow-hidden border-l transition-[width] duration-240 ease-drawer",
              panel ? "w-[360px]" : "w-0 border-l-0",
            )}
          >
            <div className="flex h-12 shrink-0 items-center gap-1 px-2 text-xs">
              <span className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-foreground">
                Review <span className="text-info-foreground tabular-nums">{reviewCount}</span>
              </span>
            </div>
            <Review
              proposals={view.proposals}
              drafts={drafts}
              finds={finds}
              findsIn={findsIn === "program" ? "programs" : findsIn ? "scholarships" : undefined}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
