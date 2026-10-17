import type { AutoRules, LoopRow, Schedule, ScopeItem, ScoutLoop } from "@getmyprof/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlayIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cadence, normalize, ScheduleEditor } from "~/components/ScheduleEditor";
import { ScopeEditor } from "~/components/ScopeEditor";
import { Choice } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
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
const AUTONOMY = ["propose", "auto"] as const;
const REPORT_TO = ["fresh", "same"] as const;
const REPORT_LABEL = { fresh: "a fresh thread each run", same: "one thread for every run" };

/** One labelled row of the loop editor; controls carry their own aria-label. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  );
}

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
      <aside className="flex flex-col gap-3 border-t p-4 text-sm md:overflow-y-auto md:border-t-0 md:border-l">
        <Input
          size="sm"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Loop name"
          aria-label="Loop name"
        />
        <Textarea
          size="sm"
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          rows={6}
          placeholder="What it should do each run, in plain words"
          aria-label="Instructions"
        />
        <Field label="When">
          <ScheduleEditor
            value={draft.schedule}
            hookToken={loops.find((l) => l.id === draft.id)?.hookToken ?? null}
            onChange={(schedule) => setDraft({ ...draft, schedule })}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Report to">
            <Choice
              label="Report to"
              value={draft.reportTo}
              options={REPORT_TO}
              labels={REPORT_LABEL}
              onChange={(reportTo) => setDraft({ ...draft, reportTo })}
            />
          </Field>
          <Field label="Budget $">
            <Input
              size="compact"
              type="number"
              step="0.1"
              min="0"
              value={draft.budgetUsd}
              aria-label="Budget"
              onChange={(e) => setDraft({ ...draft, budgetUsd: Number(e.target.value) })}
              className="w-20"
            />
          </Field>
        </div>
        <Field label="Schools">
          <ScopeEditor value={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })} />
        </Field>
        <Field label="Changes">
          <div className="flex flex-col gap-1.5 text-xs">
            <ToggleGroup
              aria-label="Autonomy"
              value={[draft.autonomy]}
              onValueChange={(v) => {
                const autonomy = AUTONOMY.find((a) => a === v[0]);
                if (autonomy) setDraft({ ...draft, autonomy });
              }}
            >
              <Toggle value="propose" size="xs">
                Propose only
              </Toggle>
              <Toggle value="auto" size="xs">
                Auto-accept rules
              </Toggle>
            </ToggleGroup>
            {draft.autonomy === "auto" ? (
              <>
                <div className="flex flex-wrap gap-3">
                  {RULES.map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1.5 text-secondary-label">
                      <Checkbox
                        aria-label={label}
                        checked={draft.rules[k]}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, rules: { ...draft.rules, [k]: checked } })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <span className="text-muted-foreground">
                  A change that passes every rule ticked goes straight to the sheet; the rest wait
                  in Review.
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Every change waits for you in Review.</span>
            )}
          </div>
        </Field>
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
