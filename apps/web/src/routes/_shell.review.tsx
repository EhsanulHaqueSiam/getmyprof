import { createFileRoute, Link } from "@tanstack/react-router";
import { ago, plural } from "~/lib/format";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/review")({ component: ReviewInbox });

/** Every thread with changes waiting, newest first. Reviewing the last one settles the thread. */
function ReviewInbox() {
  const threads = useStore((s) => s.threads).filter((t) => t.pendingReview > 0);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 px-4">
        <h1 className="font-semibold text-sm">Review</h1>
        <span className="text-muted-foreground text-xs">
          {plural(
            threads.reduce((n, t) => n + t.pendingReview, 0),
            "change",
          )}
        </span>
      </header>
      <div className="border-t">
        {threads.map((t) => (
          <Link
            key={t.id}
            to="/t/$threadId"
            params={{ threadId: t.id }}
            className="flex h-10 items-center gap-3 border-b px-4 text-sm transition-colors hover:bg-secondary"
          >
            <span className="truncate">{t.title}</span>
            <span className="ml-auto text-info-foreground text-xs tabular-nums">
              {t.pendingReview}
            </span>
            <span className="w-10 text-right text-muted-foreground text-xs">
              {ago(t.updatedAt)}
            </span>
          </Link>
        ))}
        {threads.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted-foreground text-xs">
            Nothing waits on you.
          </div>
        ) : null}
      </div>
    </div>
  );
}
