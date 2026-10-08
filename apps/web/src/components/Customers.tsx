import type { MethodOutput, TregCustomer, TregCustomers } from "@getmyprof/contracts";
import { useEffect, useState } from "react";
import { Chip } from "~/components/FormParts";
import { featureLabel, inNewTab } from "~/components/TregSettings";
import { Button } from "~/components/ui/button";
import { download } from "~/lib/files";
import { plural, usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";

// The Customers page's parts (routes/_shell.customers.tsx): auto top-up, adding a customer, one
// customer's controls, and invoices.

// $0 reads as "free" elsewhere; here it is money owed.
export const money = (v: number) => (v === 0 ? "$0.00" : usd(v));

/** A dollar amount box; Enter or leaving it saves a positive number, anything else snaps back. */
export function Dollars({
  label,
  value,
  onSave,
  placeholder,
}: {
  label: string;
  value: number | null;
  onSave: (v: number) => void;
  placeholder?: string;
}) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs">
      $
      <input
        type="number"
        min="0.01"
        step="0.01"
        defaultValue={value ?? ""}
        aria-label={label}
        placeholder={placeholder}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (e.target.value && v > 0) {
            if (v !== value) onSave(v);
          } else e.target.value = value == null ? "" : String(value);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-6.5 w-16 rounded-md border border-input bg-transparent px-1.5 text-foreground outline-none placeholder:text-placeholder"
      />
    </span>
  );
}

type Billing = NonNullable<TregCustomers["billing"]>;

/**
 * treg's auto top-up: whenever the balance drops under a floor it adds money, up to a cap a
 * month, so customers' lookups never stop on an empty balance. Turning it on consents to the
 * amounts shown; the first time, treg's tab saves a card.
 */
export function AutoTopUp({
  billing,
  balanceUsd,
  act,
}: {
  billing: Billing;
  balanceUsd: number;
  act: (work: () => Promise<void>) => Promise<void>;
}) {
  const a = billing.auto;
  const [p, setP] = useState({
    underUsd: a.underUsd,
    addUsd: a.addUsd,
    monthCapUsd: a.monthCapUsd,
  });
  const send = (on: boolean, policy = p) =>
    act(async () => {
      // Only a first switch-on, with no card yet, has a page to open.
      if (on && !a.cardOnFile) await inNewTab(() => call("treg.autoTopUp", { on, ...policy }));
      else await call("treg.autoTopUp", { on, ...policy });
    });
  const amount = (k: keyof typeof p, label: string) => (
    <Dollars
      key={`${k}-${a[k]}`}
      label={label}
      value={p[k]}
      onSave={(v) => {
        const next = { ...p, [k]: v };
        setP(next);
        // Saved at once; while it's on, that is consent to the new amounts.
        void send(a.on, next);
      }}
    />
  );
  const low = !a.on && balanceUsd < Math.max(p.underUsd, 1);
  return (
    <div className="flex flex-col gap-1 border-b px-4 py-2.5 text-xs" data-testid="auto-top-up">
      <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        <span className="text-foreground">Auto top-up</span>
        <Chip on={a.on} onClick={() => void send(!a.on)}>
          {a.on ? "On" : "Off"}
        </Chip>
        when the balance is under {amount("underUsd", "Top up when under")} add
        {amount("addUsd", "Top up by")} at most {amount("monthCapUsd", "Top up at most a month")} a
        month
        {a.on && !a.cardOnFile ? <span>· save a card in treg's tab to arm it</span> : null}
      </div>
      {a.problem ? <span className="text-destructive-foreground">{a.problem}</span> : null}
      {low ? (
        <span className="text-warning-foreground">
          Balance {money(balanceUsd)}: at $0 every customer's paid lookups stop. Top up, or turn on
          auto top-up.
        </span>
      ) : null}
    </div>
  );
}

/** A new customer: an id (letters, digits, . _ - :) and their own daily limit, or the default. */
export function AddCustomer({
  onAdd,
  onCancel,
}: {
  onAdd: (customer: string, dailyUsd: number | null) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [limit, setLimit] = useState("");
  const valid = /^[A-Za-z0-9._:-]{1,128}$/.test(id);
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onAdd(id, Number(limit) > 0 ? Number(limit) : null);
      }}
    >
      <input
        autoFocus
        value={id}
        onChange={(e) => setId(e.target.value.trim())}
        placeholder="customer id, e.g. maya"
        aria-label="Customer id"
        className="h-6.5 w-44 rounded-md border border-input bg-transparent px-1.5 text-foreground outline-none placeholder:text-placeholder"
      />
      <span className="flex items-center gap-1 text-muted-foreground">
        $
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="default"
          aria-label="Their limit a day"
          className="h-6.5 w-18 rounded-md border border-input bg-transparent px-1.5 text-foreground outline-none placeholder:text-placeholder"
        />
        a day
      </span>
      <Button size="xs" type="submit" disabled={!valid}>
        Add
      </Button>
      <Button size="xs" variant="ghost-muted" onClick={onCancel}>
        Cancel
      </Button>
      {id && !valid ? (
        <span className="text-destructive-foreground">letters, digits and . _ - : only</span>
      ) : null}
    </form>
  );
}

/** One customer's controls and what they spent on this month. */
export function CustomerDetail({
  c,
  act,
  onNewKey,
}: {
  c: TregCustomer;
  act: (work: () => Promise<TregCustomers>) => Promise<unknown>;
  onNewKey: () => void;
}) {
  // Both cut off their current key, so each asks first.
  const [asking, setAsking] = useState<"remove" | "rekey" | null>(null);
  const set = (patch: { dailyUsd?: number | null; blocked?: boolean }) =>
    void act(() => call("treg.setCustomer", { customer: c.id, ...patch }));
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="customer-detail">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">Limit</span>
        <Dollars
          key={`${c.id}-${c.dailyUsd}`}
          label={`Limit a day for ${c.id}`}
          value={c.ownLimit ? c.dailyUsd : null}
          placeholder="default"
          onSave={(dailyUsd) => set({ dailyUsd })}
        />
        <span className="text-muted-foreground">a day</span>
        {c.ownLimit ? (
          <Button size="xs" variant="ghost-muted" onClick={() => set({ dailyUsd: null })}>
            Use the default
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          onClick={() => set({ blocked: c.status !== "blocked" })}
        >
          {c.status === "blocked" ? "Unblock" : "Block"}
        </Button>
        {asking ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-destructive-foreground">
              {asking === "remove"
                ? "Their key stops working; what they spent stays on the invoice."
                : "Their current key stops working; they paste the new one."}
            </span>
            <Button
              size="xs"
              variant="destructive-outline"
              onClick={() => {
                setAsking(null);
                if (asking === "rekey") onNewKey();
                else void act(() => call("treg.removeCustomer", { customer: c.id }));
              }}
            >
              {asking === "remove" ? `Remove ${c.id}` : "Replace their key"}
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={() => setAsking(null)}>
              Keep
            </Button>
          </span>
        ) : (
          <>
            <Button size="xs" variant="outline" onClick={() => setAsking("rekey")}>
              New key
            </Button>
            <Button size="xs" variant="ghost-destructive" onClick={() => setAsking("remove")}>
              Remove
            </Button>
          </>
        )}
      </div>
      <span className="text-muted-foreground">
        {[
          plural(c.calls, "call"),
          ...c.byFeature.map((f) => `${featureLabel(f.feature)} ${money(f.usd)}`),
        ].join(" · ")}
      </span>
    </div>
  );
}

type Invoice = MethodOutput<"treg.invoice">;

// treg counts whole UTC days back from today, so the day of the month is this month so far.
const periodsNow = () => [
  { label: "This month so far", days: new Date().getUTCDate() },
  { label: "Last 30 days", days: 30 },
];

/** Invoices from treg's ledger: this month so far and the last 30 days, each as a CSV. */
export function Invoices({ count }: { count: number }) {
  const periods = periodsNow();
  const [got, setGot] = useState<Record<number, Invoice | string>>({});
  useEffect(() => {
    for (const p of periodsNow())
      void call("treg.invoice", { days: p.days }).then(
        (inv) => setGot((g) => ({ ...g, [p.days]: inv })),
        (e: unknown) =>
          setGot((g) => ({ ...g, [p.days]: e instanceof Error ? e.message : String(e) })),
      );
    // Fetched again when a customer is added or removed.
  }, [count]);
  const csv = (inv: Invoice) =>
    [
      "customer,calls,usd",
      ...inv.lines.map((l) => `${l.customer},${l.calls},${l.usd.toFixed(6)}`),
      `(own use),,${inv.unattributedUsd.toFixed(6)}`,
    ].join("\n");
  return (
    <section className="mt-6 px-4 pb-6">
      <h2 className="mb-1.5 font-medium text-sm">Invoices</h2>
      <table className="w-full max-w-2xl border-collapse text-[12.5px]">
        <thead>
          <tr>
            {["Period", "Billed", "Customers", "Ledger", ""].map((h) => (
              <th
                key={h}
                className="border-b border-input py-1.5 pr-3 text-left font-medium text-muted-foreground text-xs"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const inv = got[p.days];
            const ok = typeof inv === "object" ? inv : null;
            return (
              <tr key={p.days}>
                <td className="h-9 border-b pr-3 text-foreground">{p.label}</td>
                <td className="border-b pr-3 tabular-nums">
                  {ok ? money(ok.lines.reduce((n, l) => n + l.usd, 0)) : ""}
                </td>
                <td className="border-b pr-3 tabular-nums">{ok ? ok.lines.length : ""}</td>
                <td
                  className={cn(
                    "border-b pr-3",
                    typeof inv === "string" && "text-destructive-foreground",
                  )}
                >
                  {typeof inv === "string" ? inv : ok ? "adds up" : ""}
                </td>
                <td className="border-b">
                  {ok ? (
                    <Button
                      size="xs"
                      variant="ghost-muted"
                      onClick={() =>
                        download(
                          `treg-invoice-${p.days}d-${new Date().toISOString().slice(0, 10)}.csv`,
                          csv(ok),
                          "text/csv",
                        )
                      }
                    >
                      CSV
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-muted-foreground text-xs">
        treg's ledger counts whole days back from today, so invoice on the 1st for the month before.
      </p>
    </section>
  );
}
