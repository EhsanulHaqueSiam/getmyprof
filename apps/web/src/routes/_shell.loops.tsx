import type { Loop, Schedule } from "@gradcode/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlayIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cadence, normalize, ScheduleEditor } from "~/components/ScheduleEditor";
import { Button } from "~/components/ui/button";
import { ago } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/loops")({ component: Loops });

const when = cadence;
const BLANK: {
  name: string;
  instructions: string;
  schedule: Schedule;
  budgetUsd: number;
  enabled: boolean;
  reportTo: "fresh" | "same";
} = {
  name: "",
  instructions: "",
  schedule: { kind: "at", at: "23:00", weekdays: [] },
  budgetUsd: 0.5,
  enabled: true,
  reportTo: "fresh",
};

/** Recurring hunts. Each run is a thread that settles itself once its changes are reviewed. */
function Loops() {
  const loopsVersion = useStore((s) => s.loopsVersion);
  const threads = useStore((s) => s.threads);
  const navigate = useNavigate();
  const [loops, setLoops] = useState<Loop[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof BLANK & { id?: string }>(BLANK);

  useEffect(() => {
    void call("loops.list", {}).then((l) => {
      setLoops(l);
      setPickedId((id) => id ?? l[0]?.id ?? null);
    });
  }, [loopsVersion]);
  useEffect(() => {
    const l = loops.find((x) => x.id === pickedId);
    if (l)
      setDraft({
        id: l.id,
        name: l.name,
        instructions: l.instructions,
        schedule: normalize(l.schedule),
        budgetUsd: l.budgetUsd,
        enabled: l.enabled,
        reportTo: l.reportTo,
      });
  }, [pickedId, loops]);

  const save = async (patch: Partial<typeof draft> = {}) => {
    const saved = await call("loops.save", { ...draft, ...patch });
    setPickedId(saved.id);
  };
  const runs = threads.filter((t) => t.loopId && t.loopId === pickedId).slice(0, 8);
  // An accepted offer ends the hunt: the server stops running loops on schedule.
  const accepted = useStore((s) => s.vault?.offers.find((o) => o.status === "accepted"));

  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex min-w-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2.5 px-4">
          <h1 className="font-semibold text-sm">Loops</h1>
          <span className="text-muted-foreground text-xs">
            {accepted
              ? `paused: you accepted ${accepted.university}'s offer. Run now still works`
              : `${loops.filter((l) => l.enabled).length} on`}
          </span>
          <Button
            variant="outline"
            size="xs"
            className="ml-auto"
            onClick={() => {
              setPickedId(null);
              setDraft(BLANK);
            }}
          >
            <PlusIcon /> New loop
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto border-t">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["Loop", "Does", "When", "Last run", "Next", "State"].map((h) => (
                  <th
                    key={h}
                    className="sticky top-0 border-b border-input bg-background px-3 py-1.5 text-left font-medium text-muted-foreground text-xs"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loops.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setPickedId(l.id)}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-secondary",
                    pickedId === l.id && "bg-primary/7",
                  )}
                >
                  <td className="h-9 border-b px-3 font-medium whitespace-nowrap">{l.name}</td>
                  <td className="max-w-[320px] truncate border-b px-3 text-secondary-label">
                    {l.instructions}
                  </td>
                  <td className="border-b px-3 whitespace-nowrap">{when(l.schedule)}</td>
                  <td className="border-b px-3 text-muted-foreground">
                    {l.lastRunAt ? ago(l.lastRunAt) : "never"}
                  </td>
                  <td className="border-b px-3 text-muted-foreground whitespace-nowrap">
                    {l.nextRunAt
                      ? new Date(l.nextRunAt).toLocaleString("en-US", {
                          weekday: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                        })
                      : l.enabled && l.schedule.kind === "webhook"
                        ? "when called"
                        : "off"}
                  </td>
                  <td
                    className={cn(
                      "border-b px-3",
                      l.enabled ? "text-success-foreground" : "text-muted-foreground",
                    )}
                  >
                    {l.enabled ? "on" : "paused"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="flex flex-col gap-3 overflow-y-auto border-l p-4 text-sm">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Loop name"
          aria-label="Loop name"
          className="bg-transparent font-semibold text-sm outline-none placeholder:text-placeholder"
        />
        <textarea
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          rows={6}
          placeholder="What it should do each run, in plain words"
          aria-label="Instructions"
          className="resize-none rounded-xl border border-input bg-popover px-3 py-2.5 text-[12.5px] leading-relaxed outline-none placeholder:text-placeholder"
        />
        <ScheduleEditor
          value={draft.schedule}
          hookToken={loops.find((l) => l.id === draft.id)?.hookToken ?? null}
          onChange={(schedule) => setDraft({ ...draft, schedule })}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={draft.reportTo}
            aria-label="Report to"
            onChange={(e) =>
              setDraft({ ...draft, reportTo: e.target.value === "same" ? "same" : "fresh" })
            }
            className="h-7 rounded-lg border border-input bg-background px-2"
          >
            <option value="fresh">a fresh thread each run</option>
            <option value="same">one thread for every run</option>
          </select>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            budget $
            <input
              type="number"
              step="0.1"
              min="0"
              value={draft.budgetUsd}
              aria-label="Budget"
              onChange={(e) => setDraft({ ...draft, budgetUsd: Number(e.target.value) })}
              className="h-7 w-14 rounded-lg border border-input bg-transparent px-2 text-foreground"
            />
          </label>
        </div>
        <div className="text-muted-foreground text-xs">
          Propose only: every change waits for you in Review.
        </div>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            disabled={!draft.name.trim() || !draft.instructions.trim()}
            onClick={() => void save()}
          >
            Save
          </Button>
          {draft.id ? (
            <>
              <Button
                variant="outline"
                size="xs"
                onClick={async () => {
                  const t = await call("loops.run", { id: draft.id! });
                  void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
                }}
              >
                <PlayIcon /> Run now
              </Button>
              <Button
                variant="ghost-muted"
                size="xs"
                onClick={() => void save({ enabled: !draft.enabled })}
              >
                {draft.enabled ? "Pause" : "Resume"}
              </Button>
            </>
          ) : null}
        </div>
        {runs.length ? <div className="mt-2 text-muted-foreground text-xs">Runs</div> : null}
        {runs.map((t) => (
          <Link
            key={t.id}
            to="/t/$threadId"
            params={{ threadId: t.id }}
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-[12.5px] text-secondary-label transition-colors hover:bg-accent"
          >
            <span
              className={cn("size-1.5 rounded-full", t.unread ? "bg-foreground" : "bg-transparent")}
            />
            <span className="truncate">{t.title}</span>
            <span className="ml-auto text-muted-foreground text-xs">
              {t.settledAt
                ? "settled"
                : t.pendingReview
                  ? `review ${t.pendingReview}`
                  : ago(t.updatedAt)}
            </span>
          </Link>
        ))}
      </aside>
    </div>
  );
}
