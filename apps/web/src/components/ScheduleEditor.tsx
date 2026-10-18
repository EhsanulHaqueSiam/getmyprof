import type { Schedule } from "@getmyprof/contracts";
import { useState } from "react";
import { Choice } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KINDS = ["at", "every", "webhook"] as const;
const KIND_LABEL = { at: "at a time", every: "every N hours", webhook: "when called (webhook)" };

/** The older daily and weekly forms, shown as "at a time on these weekdays". */
export const normalize = (s: Schedule): Schedule =>
  s.kind === "daily"
    ? { kind: "at", at: s.at, weekdays: [] }
    : s.kind === "weekly"
      ? { kind: "at", at: s.at, weekdays: [s.day] }
      : s;

/** "every 6h", "weekdays 08:00", "Tue, Thu 09:00", "daily 23:00", "on webhook". */
export function cadence(raw: Schedule) {
  const s = normalize(raw);
  if (s.kind === "every") return `every ${s.hours}h`;
  if (s.kind === "webhook") return "on webhook";
  if (s.kind !== "at") return "";
  const days = s.weekdays.toSorted();
  const label =
    days.length === 0 || days.length === 7
      ? "daily"
      : days.join() === "1,2,3,4,5"
        ? "weekdays"
        : days.map((d) => DAYS[d]).join(", ");
  return `${label} ${s.at}`;
}

/** Picks when a loop runs: every N hours, at a time on chosen weekdays, or when its webhook is called. */
export function ScheduleEditor({
  value,
  onChange,
  hookToken,
}: {
  value: Schedule;
  onChange: (s: Schedule) => void;
  /** Set once a webhook loop is saved; the URL is built on this origin. */
  hookToken: string | null;
}) {
  const s = normalize(value);
  const [copied, setCopied] = useState(false);
  const url = hookToken ? `${location.origin}/api/hooks/${hookToken}` : "";
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Choice
          label="Schedule"
          // normalize folds daily and weekly into "at", so the picker only knows these three.
          value={KINDS.find((k) => k === s.kind) ?? "at"}
          options={KINDS}
          labels={KIND_LABEL}
          onChange={(kind) =>
            onChange(
              kind === "every"
                ? { kind: "every", hours: 6 }
                : kind === "webhook"
                  ? { kind: "webhook" }
                  : { kind: "at", at: "08:00", weekdays: [] },
            )
          }
        />
        {s.kind === "every" ? (
          <label className="flex items-center gap-1.5 text-muted-foreground">
            every
            <Input
              size="compact"
              type="number"
              min="0.25"
              step="0.25"
              value={s.hours}
              aria-label="Hours"
              onChange={(e) => onChange({ kind: "every", hours: Number(e.target.value) || 1 })}
              className="w-16"
            />
            hours
          </label>
        ) : null}
        {s.kind === "at" ? (
          <>
            <Input
              size="compact"
              type="time"
              value={s.at}
              aria-label="Time"
              onChange={(e) => onChange({ ...s, at: e.target.value })}
              className="w-auto"
            />
            <ToggleGroup
              multiple
              aria-label="Weekdays"
              value={DAYS.filter((_, i) => s.weekdays.includes(i))}
              onValueChange={(picked) =>
                onChange({
                  ...s,
                  weekdays: DAYS.flatMap((d, i) => (picked.includes(d) ? [i] : [])),
                })
              }
            >
              {DAYS.map((d) => (
                <Toggle key={d} value={d} size="xs">
                  {d}
                </Toggle>
              ))}
            </ToggleGroup>
            <span className="text-muted-foreground">
              {s.weekdays.length ? "" : "no day picked: every day"}
            </span>
          </>
        ) : null}
      </div>
      {s.kind === "webhook" ? (
        <div className="flex flex-col gap-1 text-muted-foreground">
          {url ? (
            <span className="flex items-center gap-2">
              <code
                className="truncate rounded-md bg-secondary px-1.5 py-0.5 font-mono text-2xs text-foreground"
                data-testid="hook-url"
              >
                {url}
              </code>
              <Button
                size="xs"
                variant="ghost-muted"
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </span>
          ) : (
            <span>Save to get its URL.</span>
          )}
          <span>
            POST JSON to it. In the instructions, {"{{body.field}}"} takes that field's value. Keep
            the URL secret: anyone with it can start a run.
          </span>
        </div>
      ) : null}
    </div>
  );
}
