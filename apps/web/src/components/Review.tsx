import type { Proposal } from "@getmyprof/contracts";
import { Link } from "@tanstack/react-router";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { CheckIcon, LinkIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";

const FIELD_LABEL: Record<string, string> = {
  emailCheck: "email check",
  fitsBecause: "fits because",
  linkedin: "LinkedIn",
  scholar: "Scholar",
  recent: "recent work",
  seeking: "looking for",
};

/** Pending proposals as field diffs. Accept writes to the sheet; reject drops it (and the person, for an add). */
/**
 * The thread's Review panel. `drafts` and `finds` count what the thread left in the Pipeline and
 * in To file, so the empty state points there instead of looking like nothing happened.
 */
export function Review({
  proposals,
  drafts = 0,
  finds = 0,
  findsIn,
  onOpen,
  selected = null,
}: {
  proposals: Proposal[];
  drafts?: number;
  finds?: number;
  /** The Vault section the finds belong in. */
  findsIn?: "scholarships" | "programs" | undefined;
  /** Opens a proposal's professor beside it. */
  onOpen?: (recordKey: string) => void;
  /** The proposal the keyboard is on: a and r act on it. */
  selected?: string | null;
}) {
  const pending = proposals.filter((p) => p.status === "pending");
  const [ref] = useAutoAnimate<HTMLDivElement>({
    duration: 220,
    easing: "cubic-bezier(0.32, 0.72, 0, 1)",
  });
  const resolve = (ids: string[], decision: "accept" | "reject") =>
    ids.length && void call("proposals.resolve", { ids, decision });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-3.5 py-3 text-xs">
        <span className="mr-auto font-semibold text-foreground">
          {pending.length} change{pending.length === 1 ? "" : "s"} to review
        </span>
        {pending.length ? (
          <>
            <Button
              variant="ghost-muted"
              size="xs"
              onClick={() =>
                resolve(
                  pending.map((p) => p.id),
                  "reject",
                )
              }
            >
              Reject all
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                resolve(
                  pending.map((p) => p.id),
                  "accept",
                )
              }
            >
              <CheckIcon /> Accept all
            </Button>
          </>
        ) : null}
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
        {pending.length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground text-xs">
            <div className="mb-0.5 font-medium text-secondary-label text-sm">Nothing to review</div>
            Accepted changes are in your sheet.
            {drafts ? (
              <Link to="/pipeline" className="mt-2 block text-info-foreground hover:underline">
                {drafts === 1 ? "1 draft waits" : `${drafts} drafts wait`} in Pipeline
              </Link>
            ) : null}
            {finds ? (
              <Link
                to="/vault"
                search={findsIn ? { section: findsIn } : {}}
                className="mt-2 block text-info-foreground hover:underline"
              >
                {finds === 1 ? "1 find waits" : `${finds} finds wait`} in To file
              </Link>
            ) : null}
          </div>
        ) : (
          pending.map((p) => (
            <div
              key={p.id}
              data-testid="proposal"
              aria-current={p.id === selected || undefined}
              className={cn("border-t px-3.5 py-3", p.id === selected && "bg-primary/7")}
            >
              <div className="flex items-baseline gap-2">
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(p.recordKey)}
                    className="truncate font-semibold text-sm hover:underline"
                  >
                    {p.recordName}
                  </button>
                ) : (
                  <span className="truncate font-semibold text-sm">{p.recordName}</span>
                )}
                <span className="truncate text-muted-foreground text-xs">{p.university}</span>
                <span className="ml-auto text-2xs text-muted-foreground">
                  {p.kind === "add" ? "new" : "update"}
                </span>
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border font-mono text-2xs leading-relaxed">
                {p.changes
                  .filter((c) => c.field !== "name" && c.field !== "university")
                  .map((c) => (
                    <div key={c.field}>
                      {c.from ? (
                        <div className="bg-destructive/8 px-2.5 text-destructive-foreground">
                          - {FIELD_LABEL[c.field] ?? c.field}: {c.from}
                        </div>
                      ) : null}
                      <div className="bg-success/8 px-2.5 text-success-foreground">
                        + {FIELD_LABEL[c.field] ?? c.field}: {c.to}
                      </div>
                      {c.disagrees ? (
                        <div
                          className="bg-warning/8 px-2.5 text-warning-foreground"
                          data-testid="disagrees"
                        >
                          ? {c.disagrees} said otherwise: accept if this source is more current
                        </div>
                      ) : null}
                    </div>
                  ))}
              </div>
              {p.sources[0] ? (
                <a
                  href={p.sources[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 flex items-center gap-1 truncate text-2xs text-muted-foreground hover:text-secondary-label"
                >
                  <LinkIcon className="size-3 shrink-0" />
                  {p.sources.map((s) => s.replace(/^https?:\/\/(www\.)?/, "")).join(" · ")}
                </a>
              ) : null}
              <div className="mt-2 flex justify-end gap-1.5">
                <Button variant="ghost-muted" size="xs" onClick={() => resolve([p.id], "reject")}>
                  Reject <Kbd className="bg-transparent">R</Kbd>
                </Button>
                <Button variant="outline" size="xs" onClick={() => resolve([p.id], "accept")}>
                  <CheckIcon /> Accept <Kbd className="bg-transparent">A</Kbd>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
