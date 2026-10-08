import type { AutoRules, LoopRow, Schedule, ScopeItem, ScoutLoop } from "@getmyprof/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlayIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cadence, normalize, ScheduleEditor } from "~/components/ScheduleEditor";
import { ScopeEditor } from "~/components/ScopeEditor";
import { Button } from "~/components/ui/button";
import { ago, usd } from "~/lib/format";
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
  scope: ScopeItem[];
  autonomy: "propose" | "auto";
  rules: AutoRules;
} = {
  name: "",
  instructions: "",
  schedule: { kind: "at", at: "23:00", weekdays: [] },
  budgetUsd: 0.5,
  enabled: true,
  reportTo: "fresh",
  scope: [],
  autonomy: "propose",
  rules: { verifiedEmail: true, officialSource: true, fit4: false },
};

const RULES: [keyof AutoRules, string][] = [
  ["verifiedEmail", "verified email"],
  ["officialSource", "official source"],
  ["fit4", "fit 4+"],
];

/** Recurring hunts. Each run is a thread that settles itself once its changes are reviewed. */
function Loops() {
  const loopsVersion = useStore((s) => s.loopsVersion);
  const threads = useStore((s) => s.threads);
  const navigate = useNavigate();
  const [loops, setLoops] = useState<LoopRow[]>([]);
  const [scout, setScout] = useState<ScoutLoop | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof BLANK & { id?: string }>(BLANK);

  useEffect(() => {
    void call("loops.list", {}).then((l) => {
      setLoops(l);
      setPickedId((id) => id ?? l[0]?.id ?? null);
    });
    void call("loops.scout", {}).then(setScout);
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
        scope: l.scope,
        autonomy: l.autonomy,
        rules: l.rules,
      });
  }, [pickedId, loops]);

  const save = async (patch: Partial<typeof draft> = {}) => {
    const saved = await call("loops.save", { ...draft, ...patch });
    setPickedId(saved.id);
  };
  const runs = threads.filter((t) => t.loopId && t.loopId === pickedId).slice(0, 8);
  // An accepted offer ends the hunt: the server stops running loops on schedule.
  const accepted = useStore((s) => s.vault?.offers.find((o) => o.status === "accepted"));
  // Webhook loops still answer their URL after the hunt ends; scheduled ones stop.
  const running = (l: (typeof loops)[number]) =>
    l.enabled && (!accepted || l.schedule.kind === "webhook");

  return (
    <div className="grid min-w-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_380px] md:overflow-visible">
      <section className="flex min-w-0 flex-col">
        <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2.5 px-4 py-2">
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
                {["Loop", "Does", "When", "Last run", "Found 7d", "Spend 7d", "State"].map((h) => (
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
                  <td className="max-w-[200px] truncate border-b px-3 text-secondary-label">
                    {l.instructions}
                  </td>
                  <td className="border-b px-3 whitespace-nowrap">{when(l.schedule)}</td>
                  <td className="max-w-[260px] truncate border-b px-3 text-secondary-label">
                    {l.lastRunAt ? (
                      <>
                        {l.lastSummary || "ran"}{" "}
                        <span className="text-muted-foreground">{ago(l.lastRunAt)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">never</span>
                    )}
                  </td>
                  <td className="border-b px-3 font-mono tabular-nums">{l.found7d}</td>
                  <td className="border-b px-3 font-mono text-muted-foreground tabular-nums">
                    {l.spend7d ? usd(l.spend7d) : "free"}
                  </td>
                  <td
                    className={cn(
                      "border-b px-3 whitespace-nowrap",
                      running(l) ? "text-success-foreground" : "text-muted-foreground",
                    )}
                  >
                    {accepted && l.schedule.kind !== "webhook"
                      ? "hunt over"
                      : running(l)
                        ? l.autonomy === "auto"
                          ? "on · auto"
                          : "on"
                        : "paused"}
                  </td>
                </tr>
              ))}
              {scout ? (
                <tr
                  data-testid="scout-loop"
                  title="Scout runs in gradhunt; getmyprof only reads it"
                >
                  <td className="h-9 border-b px-3 font-medium whitespace-nowrap">
                    Scout (gradhunt)
                  </td>
                  <td className="border-b px-3 text-muted-foreground">
                    your existing loop, shown read-only
                  </td>
                  <td className="border-b px-3 whitespace-nowrap">{scout.when}</td>
                  <td className="max-w-[260px] truncate border-b px-3 text-secondary-label">
                    {scout.lastRun}: {scout.summary}
                  </td>
                  <td className="border-b px-3 font-mono tabular-nums">{scout.found7d}</td>
                  <td className="border-b px-3 text-muted-foreground">n/a</td>
                  <td className="border-b px-3 text-muted-foreground">external</td>
                </tr>
              ) : null}
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
        <ScopeEditor value={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })} />
        <div className="flex flex-col gap-1.5 text-xs">
          <div
            className="inline-flex w-fit rounded-lg border p-0.5"
            role="radiogroup"
            aria-label="Autonomy"
          >
            {(["propose", "auto"] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={draft.autonomy === a}
                onClick={() => setDraft({ ...draft, autonomy: a })}
                className={cn(
                  "h-6 rounded-md px-2.5 transition-colors",
                  draft.autonomy === a
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {a === "propose" ? "Propose only" : "Auto-accept rules"}
              </button>
            ))}
          </div>
          {draft.autonomy === "auto" ? (
            <>
              <div className="flex flex-wrap gap-3">
                {RULES.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-secondary-label">
                    <input
                      type="checkbox"
                      checked={draft.rules[k]}
                      onChange={(e) =>
                        setDraft({ ...draft, rules: { ...draft.rules, [k]: e.target.checked } })
                      }
                      className="size-3.5 accent-foreground"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <span className="text-muted-foreground">
                A change that passes every rule ticked goes straight to the sheet; the rest wait in
                Review.
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Every change waits for you in Review.</span>
          )}
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
