import { type Professor, ROW_OPS, type RowOp } from "@gradcode/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DownloadIcon, SearchIcon, UploadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { TIER_LABEL } from "~/lib/columns";
import { download } from "~/lib/files";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

// ⌘K's schools land here with ?school=<name>.
export const Route = createFileRoute("/_shell/professors/")({
  component: Professors,
  validateSearch: (s: Record<string, unknown>): { school?: string } =>
    typeof s.school === "string" ? { school: s.school } : {},
});

const VIEWS = [
  ["all", "All", () => true],
  ["fit5", "Fit 5", (p: Professor) => p.fit >= 5],
  ["money", "Has money", (p: Professor) => p.money.trim() !== ""],
  ["taking", "Taking students", (p: Professor) => p.taking.toLowerCase().startsWith("yes")],
  ["email", "Needs email", (p: Professor) => p.emailCheck !== "ok" && p.stage !== "apply-only"],
  ["apply", "Apply-only", (p: Professor) => p.stage === "apply-only"],
] as const;

const OPS = Object.keys(ROW_OPS) as RowOp[];
const select =
  "h-7 rounded-lg border border-input bg-background px-2 text-muted-foreground text-xs outline-none";

function Professors() {
  const recordsVersion = useStore((s) => s.recordsVersion);
  const settings = useStore((s) => s.app?.settings);
  const navigate = useNavigate();
  const [rows, setRows] = useState<Professor[]>([]);
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("all");
  const [q, setQ] = useState("");
  const [tier, setTier] = useState(0);
  const { school: picked } = Route.useSearch();
  const [school, setSchool] = useState(picked ?? "");
  useEffect(() => setSchool(picked ?? ""), [picked]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<{ op: RowOp; cost: number } | null>(null);
  useEffect(() => {
    void call("records.list", {}).then(setRows);
  }, [recordsVersion]);

  const filter = VIEWS.find((v) => v[0] === view)?.[2] ?? (() => true);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (p) =>
      filter(p) &&
      (!tier || p.moneyTier === tier) &&
      (!school || p.university === school) &&
      (!needle || `${p.name} ${p.university} ${p.niche}`.toLowerCase().includes(needle)),
  );
  const schools = [...new Set(rows.map((p) => p.university))].toSorted();
  const keys = shown.map((p) => p.key).filter((k) => selected.has(k));
  const toggle = (key: string) =>
    setSelected((s) =>
      s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key]),
    );

  /** A row action on the picked rows, in a thread of its own; paid ones over your limit ask first. */
  const run = async (op: RowOp, confirmed = false) => {
    const cost = (op === "email" && settings?.treg ? ROW_OPS.email.priceUsd : 0) * keys.length;
    if (!confirmed && settings && cost > settings.budget.askOver) return setAsking({ op, cost });
    setAsking(null);
    const t = await call("threads.startRowAction", { op, keys });
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  };

  const exportCsv = async () => {
    const { csv } = await call("records.export", {});
    download("gradcode-professors.csv", csv, "text/csv");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 px-4">
        <h1 className="font-semibold text-sm">Professors</h1>
        <span className="text-muted-foreground text-xs tabular-nums">{rows.length}</span>
        <label className="ml-auto flex h-7 w-64 items-center gap-2 rounded-lg border border-input px-2.5 text-xs text-muted-foreground">
          <SearchIcon className="size-3.5" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, school, niche"
            aria-label="Search"
            className="flex-1 bg-transparent text-foreground outline-none placeholder:text-placeholder"
          />
        </label>
        <label className="cursor-pointer">
          <span className="sr-only">Import CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await call("records.import", { csv: await f.text() });
            }}
          />
          <span className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground">
            <UploadIcon className="size-3.5" /> Import
          </span>
        </label>
        <Button variant="ghost-muted" size="xs" onClick={() => void exportCsv()}>
          <DownloadIcon /> Export
        </Button>
      </header>
      <div className="flex items-center gap-0.5 px-3 pb-2">
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              "h-7 rounded-lg px-2.5 text-xs transition-colors",
              view === id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        <select
          aria-label="Money tier"
          value={tier}
          onChange={(e) => setTier(Number(e.target.value))}
          className={cn(select, "ml-2")}
        >
          <option value={0}>Any tier</option>
          {[1, 2, 3, 4].map((t) => (
            <option key={t} value={t}>
              Tier {TIER_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="School"
          value={school}
          onChange={(e) => setSchool(e.target.value)}
          className={select}
        >
          <option value="">Any school</option>
          {schools.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
      {keys.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-1.5 text-xs">
          <span className="mr-1 text-foreground">{keys.length} selected</span>
          {asking ? (
            <>
              <span className="text-warning-foreground">
                {ROW_OPS[asking.op].label} for {keys.length} · {usd(asking.cost)}
              </span>
              <Button variant="ghost-muted" size="xs" onClick={() => setAsking(null)}>
                Deny
              </Button>
              <Button size="xs" onClick={() => void run(asking.op, true)}>
                Allow once
              </Button>
            </>
          ) : (
            OPS.map((op) => (
              <Button key={op} variant="outline" size="xs" onClick={() => void run(op)}>
                {ROW_OPS[op].label}
              </Button>
            ))
          )}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto border-t">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky top-0 w-8 border-b border-input bg-background px-2">
                <input
                  type="checkbox"
                  aria-label="Select all professors"
                  className="size-3.5 accent-foreground"
                  checked={shown.length > 0 && shown.every((p) => selected.has(p.key))}
                  onChange={(e) =>
                    setSelected(new Set(e.target.checked ? shown.map((p) => p.key) : []))
                  }
                />
              </th>
              {[
                "Fit",
                "Professor",
                "School",
                "Niche",
                "Money",
                "Tier",
                "Taking students",
                "Email",
                "Stage",
              ].map((h) => (
                <th
                  key={h}
                  className="sticky top-0 border-b border-input bg-background px-3 py-1.5 text-left font-medium text-muted-foreground text-xs whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr
                key={p.key}
                className={cn(
                  "transition-colors hover:bg-secondary",
                  selected.has(p.key) && "bg-primary/7",
                )}
              >
                <td className="border-b px-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.name}`}
                    checked={selected.has(p.key)}
                    onChange={() => toggle(p.key)}
                    className="size-3.5 accent-foreground"
                  />
                </td>
                <td className="h-9 border-b px-3 font-mono font-semibold">{p.fit || "?"}</td>
                <td className="border-b px-3 font-medium whitespace-nowrap">
                  <Link to="/professors/$key" params={{ key: p.key }} className="hover:underline">
                    {p.name}
                  </Link>
                </td>
                {(["university", "niche", "money"] as const).map((f) => (
                  <td
                    key={f}
                    className="max-w-[200px] truncate border-b px-3 text-secondary-label whitespace-nowrap"
                  >
                    {p[f] || <span className="text-placeholder">?</span>}
                  </td>
                ))}
                <td className="border-b px-3 text-secondary-label whitespace-nowrap">
                  {TIER_LABEL[p.moneyTier]}
                </td>
                <td className="max-w-[200px] truncate border-b px-3 text-secondary-label whitespace-nowrap">
                  {p.taking || <span className="text-placeholder">?</span>}
                </td>
                <td
                  className={cn(
                    "border-b px-3",
                    p.emailCheck === "ok" ? "text-success-foreground" : "text-muted-foreground",
                  )}
                >
                  {p.emailCheck || "unchecked"}
                </td>
                <td className="border-b px-3 text-secondary-label">{p.stage}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted-foreground text-xs">
            {rows.length
              ? "No professor matches these filters."
              : "No professors yet. Start a thread and accept what it finds."}
          </div>
        ) : null}
      </div>
    </div>
  );
}
