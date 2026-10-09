import { deadlines } from "@getmyprof/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { FeeLine } from "~/components/VaultApplications";
import { type CalendarFilter, calendarGroups, FILTERS, SECTION } from "~/lib/calendar";
import { cn } from "~/lib/utils";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/calendar")({ component: CalendarPage });

/**
 * Every dated step of the hunt, soonest first, by week and then by month: deadlines, ask-by
 * dates, tests, interviews, offers and expiring documents. Subscribe copies the feed's URL
 * (GET /api/calendar.ics) so a calendar app keeps up on its own.
 */
function CalendarPage() {
  const vault = useStore((s) => s.vault);
  const applicant = useStore((s) => s.app?.applicant);
  const token = useStore((s) => s.app?.settings.mcpToken) ?? "";
  const [filter, setFilter] = useState<CalendarFilter>("All");
  const [copied, setCopied] = useState(false);
  const now = new Date();
  const groups = vault ? calendarGroups(deadlines(vault, applicant, now), filter, now) : [];
  // Built from where the app was opened, never baked in, so any client gets a URL that reaches it.
  const feed = `${window.location.origin}/api/calendar.ics?token=${encodeURIComponent(token)}`;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2.5 px-4 py-2">
        <h1 className="font-semibold text-sm">Calendar</h1>
        <ToggleGroup
          value={[filter]}
          onValueChange={(v) => setFilter(FILTERS.find((f) => f.label === v[0])?.label ?? filter)}
        >
          {FILTERS.map((f) => (
            <Toggle key={f.label} value={f.label} size="xs">
              {f.label}
            </Toggle>
          ))}
        </ToggleGroup>
        <FeeLine />
        <span className="ml-auto flex items-center gap-2.5">
          {copied ? (
            <span className="text-muted-foreground text-xs">
              Copied. In Google, Apple or Outlook Calendar, subscribe by URL and paste it.
            </span>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(feed);
              setCopied(true);
            }}
          >
            <CalendarIcon /> Subscribe
          </Button>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto border-t">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-[12.5px]">
          <colgroup>
            <col className="w-24" />
            <col className="w-24" />
            <col />
            <col className="w-28" />
            <col className="w-20" />
          </colgroup>
          <tbody>
            {groups.flatMap((g) => [
              <tr key={g.label}>
                <td
                  colSpan={5}
                  className="h-8 border-b border-input px-4 text-muted-foreground text-xs"
                >
                  {g.label}
                </td>
              </tr>,
              ...g.rows.map((r) => {
                const section = SECTION[r.kind];
                return (
                  <tr
                    key={r.id}
                    data-testid="calendar-row"
                    className="transition-colors hover:bg-secondary"
                  >
                    <td className="h-9 border-b pr-2 pl-4 font-mono text-secondary-label">
                      {r.day}
                    </td>
                    <td className="border-b px-2 font-mono text-2xs text-muted-foreground">
                      {r.kind}
                    </td>
                    <td
                      className="truncate border-b px-2 font-medium text-foreground"
                      title={r.detail ? `${r.title} · ${r.detail}` : r.title}
                    >
                      {r.title}{" "}
                      <span className="font-normal text-muted-foreground">{r.detail}</span>
                    </td>
                    <td
                      className={cn(
                        "border-b px-2 whitespace-nowrap",
                        r.soon ? "text-warning-foreground" : "text-muted-foreground",
                      )}
                    >
                      {r.due}
                    </td>
                    <td className="border-b pr-4 pl-2 text-right">
                      {section ? (
                        <Button
                          size="micro"
                          variant="outline"
                          render={<Link to="/vault" search={{ section }} />}
                        >
                          Open
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
        {groups.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted-foreground text-xs">
            {filter === "All"
              ? "No dates yet. Program deadlines, tests and interviews land here."
              : `Nothing under ${filter}.`}
          </div>
        ) : null}
      </div>
    </section>
  );
}
