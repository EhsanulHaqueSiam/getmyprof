import type { TregCustomers } from "@getmyprof/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { Fragment, useState } from "react";
import {
  AddCustomer,
  AutoTopUp,
  CustomerDetail,
  Dollars,
  Invoices,
  money,
} from "~/components/Customers";
import { Td } from "~/components/Table";
import { TopUp, useTregTeam } from "~/components/TregSettings";
import { Button } from "~/components/ui/button";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/customers")({ component: CustomersPage });

const STATUS = {
  active: { label: "active", className: "" },
  "at-limit": { label: "at limit", className: "text-warning-foreground" },
  blocked: { label: "blocked", className: "text-destructive-foreground" },
} as const;
// A phone shows the columns that decide something; Today and Since wait for a wider screen.
const WIDE_ONLY = new Set(["Today", "Since"]);

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * A treg team's customers, for its owner or admin: one key per customer, pinned to them by treg,
 * so their spend bills to them. Totals, the table (a row opens its limit, block, new key, remove,
 * and what they spent on), and invoices from treg's ledger.
 */
function CustomersPage() {
  const treg = useStore((s) => s.app?.treg);
  const manage = (treg?.connected && treg.manage) ?? false;
  const { team, setTeam, error, setError, load } = useTregTeam(manage);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState<{ customer: string; key: string } | null>(null);
  const [copied, setCopied] = useState<"key" | "invite" | null>(null);
  // "Quiet this month" counts from when the page opened; a day's drift doesn't matter.
  const [openedAt] = useState(() => Date.now());

  /**
   * Runs a change; one that returns the team shows it at once, otherwise the list reloads.
   * False when it failed (the error shows).
   */
  const act = async (work: () => Promise<TregCustomers | { key: string } | void>) => {
    setError("");
    try {
      const got = await work();
      if (got && "customers" in got) setTeam(got);
      else await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const issue = (customer: string, work: () => Promise<{ key: string }>) =>
    act(async () => {
      setKey({ customer, key: (await work()).key });
      setCopied(null);
    });
  // "Copied" for a moment, so copying again confirms again.
  const copy = (what: "key" | "invite", text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    });

  // What needs the owner: who hit today's limit, and active customers quiet all month.
  const monthAgo = openedAt - 30 * 864e5;
  const attention = [
    ...(team?.customers.filter((c) => c.status === "at-limit") ?? []).map(
      (c) => `${c.id} at limit`,
    ),
    ...(
      team?.customers.filter(
        (c) => c.status === "active" && c.calls === 0 && new Date(c.since).getTime() < monthAgo,
      ) ?? []
    ).map((c) => `${c.id} quiet this month`),
  ];
  // The message a new customer needs: their key and where it goes.
  const holder = team?.customers.find((c) => c.id === key?.customer);
  const terms =
    holder?.status === "blocked"
      ? " Paid lookups are paused for now."
      : holder?.dailyUsd
        ? ` It allows ${usd(holder.dailyUsd)} a day.`
        : "";
  const invite = key
    ? `Your getmyprof key for paid lookups: ${key.key}\nIn getmyprof: Settings, Paid lookups, Paste a key.${terms}`
    : "";

  if (!manage)
    return (
      <div className="m-auto max-w-sm text-center text-muted-foreground text-xs">
        Customers are for the owner or admin of a treg team. Connect that team's key in{" "}
        <Link to="/settings" className="text-foreground underline">
          Settings
        </Link>
        .
      </div>
    );

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2.5 px-4 py-2">
        <h1 className="font-semibold text-sm">Customers</h1>
        <span className="whitespace-nowrap text-muted-foreground text-xs">team {treg?.org}</span>
        {attention.length ? (
          <span className="truncate text-warning-foreground text-xs" data-testid="attention">
            {attention.join(" · ")}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon /> Add customer
          </Button>
          <TopUp amounts={team?.billing?.topUps} onError={setError} />
        </span>
      </header>
      {team ? (
        <div className="grid grid-cols-2 gap-px border-y bg-border md:grid-cols-4">
          {[
            ["Balance", money(team.balanceUsd)],
            ["Billed this month", money(team.billedUsd)],
            ["Your own use", money(team.ownUseUsd)],
          ].map(([label, value]) => (
            <div key={label} className="bg-background px-4 py-2.5">
              <div className="text-muted-foreground text-xs">{label}</div>
              <div className="font-medium text-foreground tabular-nums">{value}</div>
            </div>
          ))}
          <div className="bg-background px-4 py-2.5">
            <div className="text-muted-foreground text-xs">Default limit</div>
            <div className="flex items-center gap-1 font-medium text-foreground tabular-nums">
              <Dollars
                key={team.defaultDailyUsd}
                label="Default limit a day"
                value={team.defaultDailyUsd}
                onSave={(dailyUsd) => void act(() => call("treg.setDefaultLimit", { dailyUsd }))}
              />
              <span className="font-normal text-muted-foreground text-xs">a day</span>
            </div>
          </div>
        </div>
      ) : null}
      {team?.billing ? (
        <AutoTopUp
          billing={team.billing}
          balanceUsd={team.balanceUsd}
          act={async (work) => void (await act(work))}
        />
      ) : null}
      {adding ? (
        <AddCustomer
          onAdd={(customer, dailyUsd) =>
            void issue(customer, () => call("treg.addCustomer", { customer, dailyUsd })).then(
              (ok) => ok && setAdding(false),
            )
          }
          onCancel={() => {
            setAdding(false);
            setError("");
          }}
        />
      ) : null}
      {key && holder ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-xs">
          <span className="text-muted-foreground">Key for {key.customer}, shown once:</span>
          <code className="select-all break-all font-mono text-foreground">{key.key}</code>
          <Button size="xs" variant="outline" onClick={() => copy("key", key.key)}>
            {copied === "key" ? "Copied" : "Copy"}
          </Button>
          <Button size="xs" variant="outline" onClick={() => copy("invite", invite)}>
            {copied === "invite" ? "Copied" : "Copy invite"}
          </Button>
          <span className="text-muted-foreground">
            They paste it in their Settings, Paid lookups, Paste a key.
          </span>
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Hide the key"
            className="ml-auto"
            onClick={() => setKey(null)}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      {error ? (
        <div className="border-b px-4 py-2 text-destructive-foreground text-xs">{error}</div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]" data-testid="customers">
          <thead>
            <tr>
              {["Customer", "This month", "Today", "Limit a day", "Status", "Since"].map((h) => (
                <th
                  key={h}
                  className={cn(
                    "border-b border-input px-3 py-1.5 text-left font-medium text-muted-foreground text-xs whitespace-nowrap",
                    WIDE_ONLY.has(h) && "hidden md:table-cell",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team?.customers.map((c) => (
              <Fragment key={c.id}>
                <tr
                  tabIndex={0}
                  aria-expanded={open === c.id}
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " "))
                      return;
                    e.preventDefault();
                    setOpen(open === c.id ? null : c.id);
                  }}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-secondary",
                    open === c.id && "bg-primary/7",
                  )}
                >
                  <Td strong>{c.id}</Td>
                  <Td className="tabular-nums">{money(c.monthUsd)}</Td>
                  <Td className="hidden tabular-nums md:table-cell">{money(c.todayUsd)}</Td>
                  <Td className="tabular-nums">
                    {c.dailyUsd === null
                      ? "none"
                      : `${usd(c.dailyUsd)}${c.ownLimit ? "" : " default"}`}
                  </Td>
                  <Td className={STATUS[c.status].className}>{STATUS[c.status].label}</Td>
                  <Td muted className="hidden md:table-cell">
                    {day(c.since)}
                  </Td>
                </tr>
                {open === c.id ? (
                  <tr>
                    <td colSpan={6} className="border-b bg-primary/4 px-3 py-2.5">
                      <CustomerDetail
                        c={c}
                        act={act}
                        onNewKey={() =>
                          void issue(c.id, () => call("treg.newKey", { customer: c.id }))
                        }
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {team && team.customers.length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground text-xs">
            No customers yet. Add one: they get a key that bills their paid lookups to them.
          </div>
        ) : null}
        {!team && !error ? (
          <div className="px-6 py-12 text-center text-muted-foreground text-xs">Loading</div>
        ) : null}
      </div>
      {team ? <Invoices count={team.customers.length} /> : null}
    </div>
  );
}
