import type { Band, Requirement } from "@getmyprof/contracts";
import { cn } from "~/lib/utils";

const TONE: Record<Band, string> = {
  reach: "text-destructive-foreground",
  match: "text-warning-foreground",
  likely: "text-success-foreground",
};

/** A program's band for this applicant: reach, match or likely. Never a percentage. */
export function ChanceBand({ band, className }: { band: Band; className?: string }) {
  return (
    <span className={cn("font-medium", TONE[band], className)} data-testid="chance-band">
      {band}
    </span>
  );
}

const STATUS: Record<Requirement["status"], [string, string]> = {
  meets: ["meets", "text-success-foreground"],
  strong: ["strong", "text-success-foreground"],
  short: ["short", "text-destructive-foreground"],
  high: ["selective", "text-warning-foreground"],
  gap: ["gap", "text-warning-foreground"],
  unknown: ["can't compare", "text-muted-foreground"],
};

/**
 * The lines behind a band, the program against the applicant: what it asks, what they have,
 * and how it reads; then what would move it.
 */
export function ChanceLines({ lines, moves }: { lines: Requirement[]; moves: string[] }) {
  return (
    <div data-testid="chance-lines">
      <div className="grid grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)_84px] gap-x-3 gap-y-1">
        {lines.map((l) => {
          const [label, tone] = STATUS[l.status];
          return (
            <div key={l.what} className="contents">
              <span className="text-muted-foreground">{l.what}</span>
              <span className="text-secondary-label">{l.program}</span>
              <span className="text-secondary-label">{l.you}</span>
              <span className={tone}>{label}</span>
            </div>
          );
        })}
      </div>
      {moves.length ? (
        <div className="mt-1.5 text-muted-foreground">Would move it: {moves.join("; ")}</div>
      ) : null}
    </div>
  );
}
