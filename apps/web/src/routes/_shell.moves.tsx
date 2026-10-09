import { type Move, nextMoves, type Professor } from "@getmyprof/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/moves")({ component: MovesPage });

const DAY = 864e5;
/** Whole days from today to a YYYY-MM-DD date. */
const daysTo = (by: string, now: Date) =>
  Math.round(
    (new Date(`${by}T00:00:00`).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      DAY,
  );
const when = (days: number, by: string) =>
  days <= 0
    ? "today"
    : days === 1
      ? "tomorrow"
      : new Date(`${by}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Where a move is done, as a link. */
function Go({ to }: { to: Move["to"] }) {
  if (to.page === "vault")
    return (
      <Button
        variant="outline"
        size="xs"
        render={<Link to="/vault" search={{ section: to.section }} />}
      >
        Open
      </Button>
    );
  return (
    <Button variant="outline" size="xs" render={<Link to={`/${to.page}`} />}>
      Open
    </Button>
  );
}

/**
 * What to do next to get funded: one list, soonest first, each move with why, when, its lane
 * (Money, Admission, Profile, Outreach) and where it's done. Built from what the app already
 * knows (nextMoves); it changes as the Vault, the Pipeline and the sheet do.
 */
function MovesPage() {
  const app = useStore((s) => s.app);
  const vault = useStore((s) => s.vault);
  const conversations = useStore((s) => s.conversations);
  const recordsVersion = useStore((s) => s.recordsVersion);
  const [records, setRecords] = useState<Professor[]>([]);
  useEffect(() => {
    void call("records.list", {}).then(setRecords);
  }, [recordsVersion]);
  if (!app || !vault) return <div className="flex-1" />;
  const now = new Date();
  const moves = nextMoves(
    { vault, applicant: app.applicant, facts: app.facts, records, conversations },
    now,
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-2.5 px-4 py-2">
        <h1 className="font-semibold text-sm">Next moves</h1>
        <span className="text-muted-foreground text-xs">
          {app.hunt?.name ?? "Your hunt"} · soonest first
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto border-t">
        {moves.map((m) => {
          const days = daysTo(m.by, now);
          return (
            <div
              key={m.id}
              data-testid="move"
              className="grid grid-cols-[10px_minmax(0,1fr)_84px_80px_64px] items-start gap-3 border-b px-4 py-2.5"
            >
              <span
                className={cn(
                  "mt-1.5 size-1.5 rounded-full",
                  days <= 2
                    ? "bg-destructive"
                    : days <= 14
                      ? "bg-warning"
                      : "bg-muted-foreground/50",
                )}
              />
              <div className="min-w-0">
                <div className="text-sm">{m.title}</div>
                <div className="text-muted-foreground text-xs">{m.why}</div>
              </div>
              <span className="pt-0.5 text-secondary-label text-xs tabular-nums">
                {when(days, m.by)}
              </span>
              <span className="pt-0.5 text-muted-foreground text-xs">{m.lane}</span>
              <Go to={m.to} />
            </div>
          );
        })}
        {moves.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted-foreground text-xs">
            Nothing waits on you. New moves show up as deadlines near and replies come in.
          </div>
        ) : null}
      </div>
    </section>
  );
}
