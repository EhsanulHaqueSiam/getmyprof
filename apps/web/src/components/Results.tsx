import { type Professor, ROW_OPS, type RowOp, type ThreadView } from "@gradcode/contracts";
import { Link } from "@tanstack/react-router";
import {
  BanknoteIcon,
  CheckIcon,
  CircleAlertIcon,
  LoaderIcon,
  MailIcon,
  PenLineIcon,
  TableIcon,
  UserIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Composer } from "~/components/Composer";
import { COLUMNS, dimmed, haystack, RANK, TIER_LABEL, tone } from "~/lib/columns";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const OP_ICON: Record<RowOp, ReactNode> = {
  email: <MailIcon />,
  lasts: <BanknoteIcon />,
  taking: <UserIcon />,
  draft: <PenLineIcon />,
};
const OPS = Object.keys(ROW_OPS) as RowOp[];

/** A thread's rows as a grid, plus the dock that runs row actions on the selection. */
export function Results({ view, threadId }: { view: ThreadView; threadId: string }) {
  const settings = useStore((s) => s.app?.settings);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [ask, setAsk] = useState<{ op: RowOp; cost: number } | null>(null);
  const [running, setRunning] = useState<{ field: string; keys: string[] } | null>(null);
  // This thread's own detail, else the install's.
  const detail = view.thread.detail ?? settings?.detail ?? "std";
  const needle = filter.trim().toLowerCase();
  const rows = needle ? view.rows.filter((r) => haystack(r).includes(needle)) : view.rows;
  const cols = COLUMNS.filter((c) => RANK[c.level] <= RANK[detail]);
  const working = view.thread.status !== "idle";

  useEffect(() => {
    if (!working) setRunning(null);
  }, [working]);

  const pending = view.proposals.filter((p) => p.status === "pending");
  const changed = new Map<string, Set<string>>();
  for (const p of pending)
    for (const c of p.changes)
      changed.set(p.recordKey, (changed.get(p.recordKey) ?? new Set()).add(c.field));
  const proposedCells = [...changed.values()].reduce((n, s) => n + s.size, 0);
  const keys = rows.map((r) => r.key).filter((k) => selected.has(k));
  const toggle = (key: string) =>
    setSelected((s) =>
      s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key]),
    );

  // What the row actions that fill this cell's column spent on this row.
  const cellCost = (key: string, field: string) =>
    OPS.filter((op) => ROW_OPS[op].field === field).reduce(
      (n, op) => n + (view.costs[key]?.[op] ?? 0),
      0,
    );
  const opPrice = (op: RowOp) => (op === "email" && settings?.treg ? ROW_OPS.email.priceUsd : 0);
  const runOp = (op: RowOp, confirmed = false) => {
    const cost = opPrice(op) * keys.length;
    if (!confirmed && settings && cost > settings.budget.askOver) return setAsk({ op, cost });
    setAsk(null);
    setRunning({ field: ROW_OPS[op].field, keys });
    void call("threads.rowAction", { id: threadId, op, keys });
  };
  const log = view.events
    .filter((e) => e.type === "user" && e.text.startsWith("Row action:"))
    .slice(-6);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-4 pb-2.5">
          <div
            className="inline-flex rounded-lg border p-0.5"
            role="radiogroup"
            aria-label="Detail"
          >
            {(["brief", "std", "deep"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={detail === d}
                onClick={() => void call("threads.setDetail", { id: threadId, detail: d })}
                className={cn(
                  "h-6 rounded-md px-2.5 text-xs transition-colors",
                  detail === d
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {{ brief: "Brief", std: "Standard", deep: "Deep" }[d]}
              </button>
            ))}
          </div>
          <div className="w-52">
            <Input
              size="compact"
              type="search"
              aria-label="Filter rows"
              placeholder="Filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <span className="ml-auto text-muted-foreground text-xs">
            {needle ? `${rows.length} of ${view.rows.length}` : view.rows.length} rows ·{" "}
            {keys.length} selected
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 w-8 border-b border-input bg-background px-2">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    className="size-3.5 accent-foreground"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.key))}
                    onChange={(e) =>
                      setSelected(new Set(e.target.checked ? rows.map((r) => r.key) : []))
                    }
                  />
                </th>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className="sticky top-0 z-10 whitespace-nowrap border-b border-input bg-background px-2 py-1.5 text-left font-medium text-muted-foreground text-xs"
                  >
                    {c.label}
                    {c.source ? (
                      <span className="block font-mono font-normal text-3xs text-placeholder">
                        {c.source}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  data-testid="result-row"
                  data-dimmed={dimmed(r) || undefined}
                  className={cn(
                    "transition-colors hover:bg-secondary",
                    selected.has(r.key) && "bg-primary/7",
                    dimmed(r) && "opacity-45",
                  )}
                >
                  <td className="border-b px-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={selected.has(r.key)}
                      onChange={() => toggle(r.key)}
                      className="size-3.5 accent-foreground"
                    />
                  </td>
                  {cols.map((c) => {
                    const isRunning = running?.keys.includes(r.key) && running.field === c.key;
                    const isChanged = changed.get(r.key)?.has(String(c.key));
                    const cost = cellCost(r.key, String(c.key));
                    const value =
                      c.key === "sources"
                        ? r.sources
                            .map((s) => s.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])
                            .join(", ")
                        : c.key === "moneyTier"
                          ? (TIER_LABEL[r.moneyTier] ?? "?")
                          : String(r[c.key as keyof Professor] ?? "");
                    return (
                      <td
                        key={c.key}
                        className={cn(
                          "h-9 max-w-[180px] truncate whitespace-nowrap border-b px-2 text-secondary-label",
                          c.key === "name" && "max-w-[280px]",
                          tone(c.key, value),
                          c.key === "fit" && "font-mono font-semibold text-foreground",
                          c.key === "name" && "font-medium text-foreground",
                          isChanged &&
                            "animate-cell-fill bg-primary/12 text-foreground shadow-[inset_2px_0_0_var(--color-primary)]",
                        )}
                      >
                        {isRunning ? (
                          <span className="inline-flex items-center gap-1.5 text-status-working">
                            <LoaderIcon className="size-3" /> running
                          </span>
                        ) : c.key === "name" ? (
                          <Link
                            to="/professors/$key"
                            params={{ key: r.key }}
                            className="hover:underline"
                          >
                            {r.name}{" "}
                            <span className="font-normal text-muted-foreground">
                              {r.university}
                            </span>
                          </Link>
                        ) : (
                          <>
                            {value || <span className="text-placeholder">?</span>}
                            {cost ? (
                              <span className="ml-1.5 font-mono text-2xs text-muted-foreground">
                                {usd(cost)}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <div className="px-6 py-16 text-center text-muted-foreground text-xs">
              {needle
                ? "No row matches the filter."
                : "No rows yet. Professors this thread finds show up here."}
            </div>
          ) : null}
        </div>
        <div className="flex h-10 shrink-0 items-center gap-3 border-t px-4 text-muted-foreground text-xs">
          <span className="text-foreground">{keys.length} selected</span>
          <span>{view.thread.spendUsd ? `${usd(view.thread.spendUsd)} spent` : "free so far"}</span>
          <span className="ml-auto">
            {proposedCells} proposed cell{proposedCells === 1 ? "" : "s"}
          </span>
          <Button
            variant="ghost-muted"
            size="xs"
            disabled={!pending.length}
            onClick={() =>
              void call("proposals.resolve", { ids: pending.map((p) => p.id), decision: "reject" })
            }
          >
            Reject
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={!pending.length}
            onClick={() =>
              void call("proposals.resolve", { ids: pending.map((p) => p.id), decision: "accept" })
            }
          >
            <CheckIcon /> Accept
          </Button>
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col border-l">
        <div className="flex h-12 items-center gap-2 px-4 text-sm">
          <span className="font-semibold">Agent</span>
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            <TableIcon className="size-3.5" /> {keys.length} selected
          </span>
        </div>
        <div className="px-4 pt-1 pb-1 text-muted-foreground text-xs">Row actions</div>
        <div
          className={cn(
            "flex flex-col px-1.5",
            (keys.length === 0 || working) && "pointer-events-none opacity-40",
          )}
        >
          {OPS.map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => runOp(op)}
              className="grid h-8.5 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] transition-[background-color,scale] hover:bg-accent active:scale-[0.99] [&>svg]:size-3.5 [&>svg]:text-muted-foreground"
            >
              {OP_ICON[op]}
              {ROW_OPS[op].label}
              <span className="font-mono text-2xs text-muted-foreground">
                {opPrice(op) ? usd(opPrice(op) * Math.max(keys.length, 1)) : "free"}
              </span>
            </button>
          ))}
        </div>
        {ask ? (
          <div
            className="mx-3 mt-1.5 animate-fade-up rounded-2xl border border-warning/24 bg-warning/4 px-3.5 py-3"
            data-testid="row-approval"
          >
            <div className="flex items-center gap-2 font-medium text-warning-foreground text-xs">
              <CircleAlertIcon className="size-3.5" /> Approval · paid action
            </div>
            <div className="mt-1.5 text-sm">
              {ROW_OPS[ask.op].label} for {keys.length} rows · {usd(ask.cost)}
            </div>
            <div className="mt-2.5 flex justify-end gap-1.5">
              <Button variant="ghost-muted" size="xs" onClick={() => setAsk(null)}>
                Deny
              </Button>
              <Button size="xs" onClick={() => runOp(ask.op, true)}>
                Allow once
              </Button>
            </div>
          </div>
        ) : null}
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t px-4 pt-2">
          {log.length === 0 ? (
            <div className="py-2 text-muted-foreground text-xs">
              Actions on the selected rows show up here and in the chat.
            </div>
          ) : (
            log.map((e) => (
              <div
                key={e.id}
                className="flex h-6.5 animate-fade-up items-center gap-2 text-muted-foreground text-xs"
              >
                <CheckIcon className="size-3 shrink-0" />
                <span className="truncate text-secondary-label">
                  {e.type === "user" ? e.text.replace("Row action: ", "") : ""}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="p-3">
          <Composer
            compact
            working={working}
            placeholder={`Ask about ${keys.length || "the"} ${keys.length === 1 ? "row" : "rows"}`}
            onSend={(text, delivery, _attachments, scope) => {
              const picked = rows.filter((r) => selected.has(r.key));
              const names = picked.map((r) => `${r.name} (${r.university})`);
              void call("threads.send", {
                id: threadId,
                text: names.length ? `About ${names.join(", ")}: ${text}` : text,
                delivery,
                // The selected rows join the thread's scope, so the agent has their records.
                scope: [
                  ...scope,
                  ...picked.map((r) => ({ kind: "professor" as const, key: r.key, name: r.name })),
                ],
              });
            }}
            onStop={() => void call("threads.stop", { id: threadId })}
          />
        </div>
      </aside>
    </div>
  );
}
