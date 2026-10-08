import type { Professor, SchoolTier } from "@getmyprof/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { SchoolDock } from "~/components/SchoolDock";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { plural } from "~/lib/format";
import { type SchoolRow, schoolRows, suggestPrompt, TIER_TONE, TIERS } from "~/lib/schools";
import { cn } from "~/lib/utils";
import { daysLeft, due } from "~/lib/vault";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/schools")({ component: Schools });

const HEAD = ["School", "Rank", "Deadline", "Fee · waiver", "Funding", "Profs"];

/**
 * The school shortlist by tier: what the agent suggests waits for keep or drop, and each school
 * shows its first program to close, the professors found there and who was emailed. Actions on
 * the selected schools each start a thread scoped to them.
 */
function Schools() {
  const navigate = useNavigate();
  const vault = useStore((s) => s.vault);
  const sweep = useStore((s) => s.app?.hunt?.prefs.sweep);
  const recordsVersion = useStore((s) => s.recordsVersion);
  const [records, setRecords] = useState<Professor[]>([]);
  const [tier, setTier] = useState<SchoolTier | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const [showDropped, setShowDropped] = useState(false);
  useEffect(() => {
    void call("records.list", {}).then(setRecords);
  }, [recordsVersion]);

  const schools = vault?.schools ?? [];
  const needle = filter.trim().toLowerCase();
  const rows = schoolRows(schools, vault?.programs ?? [], records).filter(
    ({ school: s }) =>
      (!tier || s.tier === tier) &&
      (!needle || `${s.name} ${s.country} ${s.why}`.toLowerCase().includes(needle)),
  );
  const picked = rows.filter((r) => selected.has(r.school.id));
  const suggested = schools.filter((s) => s.status === "suggested");
  const dropped = rows.filter((r) => r.school.status === "dropped");
  const focus = schools.find((s) => s.id === current) ?? picked[0]?.school ?? null;
  const toggle = (id: string) =>
    setSelected((s) => (s.has(id) ? new Set([...s].filter((k) => k !== id)) : new Set([...s, id])));
  /** Asks the agent to top each tier up, in a thread of its own. */
  const suggest = async () => {
    const text = suggestPrompt(schools, sweep ?? { reach: 3, match: 3, safety: 3 });
    const t = await call("threads.create", { text, title: "Suggest schools" });
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  };

  return (
    <div className="grid min-w-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-visible">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2.5 px-4 py-2">
          <h1 className="font-semibold text-sm">Schools</h1>
          <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Tier">
            {[null, ...TIERS].map((t) => (
              <button
                key={t ?? "all"}
                type="button"
                role="radio"
                aria-checked={tier === t}
                onClick={() => setTier(t)}
                className={cn(
                  "h-6 rounded-md px-2.5 text-xs capitalize transition-colors",
                  tier === t
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t ?? "All"}
              </button>
            ))}
          </div>
          <div className="w-52">
            <Input
              size="compact"
              type="search"
              aria-label="Filter schools"
              placeholder="Filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <span className="ml-auto text-muted-foreground text-xs">
            {plural(rows.length - dropped.length, "school")} · {picked.length} selected
          </span>
          <Button size="xs" onClick={() => void suggest()}>
            <SparklesIcon /> Suggest schools
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto border-t">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 w-8 border-b border-input bg-background px-2" />
                {HEAD.map((h) => (
                  <th
                    key={h}
                    className="sticky top-0 z-10 whitespace-nowrap border-b border-input bg-background px-2 py-1.5 text-left font-medium text-muted-foreground text-xs"
                  >
                    {h}
                    {h === "Profs" ? (
                      <span className="block font-mono font-normal text-3xs text-placeholder">
                        found · funded · mailed
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIERS.flatMap((t) => {
                const inTier = rows.filter(
                  (r) => r.school.tier === t && r.school.status !== "dropped",
                );
                if (!inTier.length) return [];
                const waiting = inTier.filter((r) => r.school.status === "suggested").length;
                return [
                  <tr key={t}>
                    <td className="border-b border-input" />
                    <td
                      colSpan={HEAD.length}
                      className="h-8 border-b border-input px-2 text-muted-foreground text-xs"
                    >
                      <span className={cn("capitalize", TIER_TONE[t])}>{t}</span>{" "}
                      {inTier.length - waiting} kept{sweep ? ` of ${sweep[t]}` : ""}
                      {waiting ? ` · ${waiting} suggested` : ""}
                    </td>
                  </tr>,
                  ...inTier.map((r) => (
                    <Row
                      key={r.school.id}
                      row={r}
                      checked={selected.has(r.school.id)}
                      current={focus?.id === r.school.id}
                      onCheck={() => toggle(r.school.id)}
                      onOpen={() => setCurrent(r.school.id)}
                    />
                  )),
                ];
              })}
              {dropped.length ? (
                <tr>
                  <td className="border-b" />
                  <td colSpan={HEAD.length} className="h-8 border-b px-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowDropped((v) => !v)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Dropped {dropped.length}
                    </button>
                  </td>
                </tr>
              ) : null}
              {showDropped
                ? dropped.map((r) => (
                    <Row
                      key={r.school.id}
                      row={r}
                      checked={selected.has(r.school.id)}
                      current={focus?.id === r.school.id}
                      onCheck={() => toggle(r.school.id)}
                      onOpen={() => setCurrent(r.school.id)}
                    />
                  ))
                : null}
            </tbody>
          </table>
          {schools.length === 0 ? (
            <div className="px-6 py-16 text-center text-muted-foreground text-xs">
              No schools yet. Suggest schools, then keep the ones that fit.
            </div>
          ) : null}
        </div>
      </section>

      <SchoolDock picked={picked} suggested={suggested} focus={focus} onFocus={setCurrent} />
    </div>
  );
}

/** One school: its name opens its professors; clicking the row shows why it's in its tier. */
function Row({
  row: { school: s, program, professors, funded, emailed },
  checked,
  current,
  onCheck,
  onOpen,
}: {
  row: SchoolRow;
  checked: boolean;
  current: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const cell = "h-9 max-w-[130px] truncate whitespace-nowrap border-b px-2 text-secondary-label";
  const deadline = program?.deadline;
  return (
    <tr
      data-testid="school-row"
      onClick={onOpen}
      className={cn(
        "cursor-default transition-colors hover:bg-secondary",
        checked && "bg-primary/7",
        s.status === "suggested" && "bg-primary/12 shadow-[inset_2px_0_0_var(--color-primary)]",
        // A suggestion keeps its blue bar; the dock shows which row is open.
        current && s.status !== "suggested" && "shadow-[inset_2px_0_0_var(--color-foreground)]",
        s.status === "dropped" && "opacity-45",
      )}
    >
      <td className="border-b px-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${s.name}`}
          checked={checked}
          onChange={onCheck}
          className="size-3.5 accent-foreground"
        />
      </td>
      <td className={cn(cell, "max-w-[230px] font-medium text-foreground")} title={s.name}>
        {professors[0] ? (
          <Link
            to="/professors"
            search={{ school: professors[0].university }}
            className="hover:underline"
          >
            {s.name}
          </Link>
        ) : (
          s.name
        )}{" "}
        <span className="font-normal text-muted-foreground">
          {s.country}
          {/* Most programs admit by committee; advisor hiring changes how to apply. */}
          {s.admits === "advisor" ? " · advisor hires" : ""}
        </span>
      </td>
      <td className={cn(cell, "max-w-[110px] text-xs")} title={s.rank}>
        {s.rank || <span className="text-placeholder">?</span>}
      </td>
      <td
        className={cn(
          cell,
          deadline &&
            daysLeft(deadline) >= 0 &&
            daysLeft(deadline) <= 30 &&
            "text-warning-foreground",
        )}
      >
        {deadline ? (
          <span title={due(deadline)}>{deadline}</span>
        ) : (
          <span className="text-placeholder">?</span>
        )}
      </td>
      <td className={cell} title={program ? `${program.fee} · ${program.waiver}` : undefined}>
        {program ? (
          `${program.fee} · ${program.waiver}`
        ) : (
          <span className="text-placeholder">?</span>
        )}
      </td>
      <td className={cell} title={program?.funding}>
        {program?.funding || <span className="text-placeholder">?</span>}
      </td>
      <td className={cn(cell, "tabular-nums")}>
        {professors.length} · {funded} · {emailed}
      </td>
    </tr>
  );
}
