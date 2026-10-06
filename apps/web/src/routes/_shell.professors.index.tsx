import type { Professor } from "@gradcode/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DownloadIcon, SearchIcon, UploadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/professors/")({ component: Professors });

const VIEWS = [
  ["all", "All", () => true],
  ["fit5", "Fit 5", (p: Professor) => p.fit >= 5],
  ["money", "Has money", (p: Professor) => p.money.trim() !== ""],
  ["taking", "Taking students", (p: Professor) => p.taking.toLowerCase().startsWith("yes")],
  ["email", "Needs email", (p: Professor) => p.emailCheck !== "ok" && p.stage !== "apply-only"],
  ["apply", "Apply-only", (p: Professor) => p.stage === "apply-only"],
] as const;

function Professors() {
  const recordsVersion = useStore((s) => s.recordsVersion);
  const [rows, setRows] = useState<Professor[]>([]);
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("all");
  const [q, setQ] = useState("");
  useEffect(() => {
    void call("records.list", {}).then(setRows);
  }, [recordsVersion]);

  const filter = VIEWS.find((v) => v[0] === view)?.[2] ?? (() => true);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (p) =>
      filter(p) &&
      (!needle || `${p.name} ${p.university} ${p.niche}`.toLowerCase().includes(needle)),
  );

  const exportCsv = async () => {
    const { csv } = await call("records.export", {});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "gradcode-professors.csv";
    a.click();
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
      <div className="flex gap-0.5 px-3 pb-2">
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
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {[
                "Fit",
                "Professor",
                "School",
                "Niche",
                "Money",
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
              <tr key={p.key} className="transition-colors hover:bg-secondary">
                <td className="h-9 border-b px-3 font-mono font-semibold">{p.fit}</td>
                <td className="border-b px-3 font-medium whitespace-nowrap">
                  <Link to="/professors/$key" params={{ key: p.key }} className="hover:underline">
                    {p.name}
                  </Link>
                </td>
                {(["university", "niche", "money", "taking"] as const).map((f) => (
                  <td
                    key={f}
                    className="max-w-[200px] truncate border-b px-3 text-secondary-label whitespace-nowrap"
                  >
                    {p[f] || <span className="text-placeholder">?</span>}
                  </td>
                ))}
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
            No professors yet. Start a thread and accept what it finds.
          </div>
        ) : null}
      </div>
    </div>
  );
}
