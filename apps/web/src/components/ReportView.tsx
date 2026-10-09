import type { ProgressReport } from "@getmyprof/contracts";
import type { ReactNode } from "react";
import { plural } from "~/lib/format";
import { TIER_TONE } from "~/lib/schools";
import { cn } from "~/lib/utils";

// A bare YYYY-MM-DD is a calendar day, not UTC midnight, so it never shows a day early.
const day = (s: string) =>
  new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

function Head({ children, muted }: { children: ReactNode; muted: string }) {
  return <h2 className={cn("mt-6 mb-1.5 font-medium text-xs", muted)}>{children}</h2>;
}

/** One table row; cells are positional and never reorder. */
function Row({ cells, line }: { cells: ReactNode[]; line: string }) {
  return (
    <tr className={cn("border-b", line)}>
      {cells.map((c, i) => (
        // oxlint-disable-next-line react/no-array-index-key
        <td key={i} className="py-1.5 pr-4 align-top">
          {c}
        </td>
      ))}
    </tr>
  );
}

/**
 * The progress report as one page: counts, the shortlist by tier, replies and the next 30 days.
 * The Report page shows it in the app, /print/report on paper, and a counselor's Students page
 * shows each student's copy. `paper` swaps the app's dark tones for ink on white.
 */
export function ReportView({ report, paper = false }: { report: ProgressReport; paper?: boolean }) {
  const muted = paper ? "text-ink/60" : "text-muted-foreground";
  const line = paper ? "border-ink/15" : "border-border";
  const { counts } = report;
  return (
    <div className="text-[13px]" data-testid="progress-report">
      <div className={cn("text-xs", muted)}>getmyprof · progress report · {day(report.at)}</div>
      <h1 className="mt-1 font-semibold text-lg">{report.hunt}</h1>
      <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
        {(
          [
            [counts.schools, "schools kept"],
            [counts.professors, "professors found"],
            [counts.emailed, "emailed"],
            [counts.replied, "replied"],
            [counts.applications, "applications started"],
          ] as const
        ).map(([n, label]) => (
          <div key={label}>
            <b className="block font-semibold text-xl tabular-nums">{n}</b>
            <span className={cn("text-xs", muted)}>{label}</span>
          </div>
        ))}
      </div>

      <Head muted={muted}>Shortlist</Head>
      {report.shortlist.length ? (
        <table className="w-full border-collapse">
          <tbody>
            {report.shortlist.map((s) => (
              <Row
                key={s.name}
                line={line}
                cells={[
                  <span key="t" className={paper ? "" : TIER_TONE[s.tier]}>
                    {s.tier}
                  </span>,
                  s.name,
                  plural(s.professors, "professor"),
                  `${s.emailed} emailed${s.replied ? ` · ${s.replied} replied` : ""}`,
                  s.deadline ? (
                    day(s.deadline)
                  ) : (
                    <span key="d" className={muted}>
                      no deadline yet
                    </span>
                  ),
                ]}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className={muted}>No schools kept yet.</p>
      )}

      <Head muted={muted}>Replies</Head>
      {report.replies.length ? (
        <table className="w-full border-collapse">
          <tbody>
            {report.replies.map((r) => (
              <Row
                key={`${r.name}${r.at}`}
                line={line}
                cells={[
                  `${r.name} · ${r.university}`,
                  r.note || (
                    <span key="n" className={muted}>
                      replied
                    </span>
                  ),
                  <span key="d" className={muted}>
                    {day(r.at)}
                  </span>,
                ]}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className={muted}>No replies yet.</p>
      )}

      <Head muted={muted}>Next 30 days</Head>
      {report.upcoming.length ? (
        <table className="w-full border-collapse">
          <tbody>
            {report.upcoming.map((u) => (
              <Row key={`${u.date}${u.title}`} line={line} cells={[day(u.date), u.title]} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className={muted}>Nothing due in the next 30 days.</p>
      )}
    </div>
  );
}
