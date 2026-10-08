import { ROW_OPS, type RowOp, type TregCustomers, type TregStatus } from "@getmyprof/contracts";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Chip } from "~/components/FormParts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { plural, usd } from "~/lib/format";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/** A spend ledger feature tag in words: hunts, loops, or a row action's name. */
export const featureLabel = (f: string) =>
  f.startsWith("row-") && f.slice(4) in ROW_OPS ? ROW_OPS[f.slice(4) as RowOp].label : `${f}s`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Opens a tab while the click still counts (popup blockers allow it), then sends it to the page
 * `get` returns. No page, or an error: the tab closes.
 */
export async function inNewTab<T extends { url: string }>(get: () => Promise<T>) {
  const tab = window.open("", "_blank");
  try {
    const got = await get();
    if (tab && got.url) {
      tab.opener = null;
      tab.location.href = got.url;
    } else tab?.close();
    return got;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/**
 * The treg team's customers and balance, for its owner or admin (`on`). Reloads when the window
 * regains focus, so a top-up paid in another tab shows on return.
 */
export function useTregTeam(on: boolean) {
  const [team, setTeam] = useState<TregCustomers | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      call("treg.customers", {}).then(
        (t) => {
          setTeam(t);
          setError("");
        },
        (e: unknown) => setError(message(e)),
      ),
    [],
  );
  useEffect(() => {
    if (!on) return;
    void load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [on, load]);
  return { team, setTeam, error, setError, load };
}

// treg's usual amounts, for when it doesn't say.
const TOP_UPS = [10, 50, 100, 200].map((dollars) => ({ usd: dollars, bonusUsd: 0 }));

/**
 * Adds money to the team's treg balance: one of treg's amounts (bigger ones carry its bonus),
 * then its checkout in a new tab.
 */
export function TopUp({
  amounts = TOP_UPS,
  onError,
}: {
  amounts?: { usd: number; bonusUsd: number }[] | undefined;
  onError: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Top up
      </Button>
    );
  return (
    <span className="flex flex-wrap items-center gap-1">
      {amounts.map((a) => (
        <Button
          key={a.usd}
          size="xs"
          variant="outline"
          onClick={() =>
            inNewTab(() => call("treg.topUp", { usd: a.usd })).then(
              () => setOpen(false),
              (err: unknown) => onError(message(err)),
            )
          }
        >
          ${a.usd}
          {a.bonusUsd ? <span className="text-success-foreground">+${a.bonusUsd}</span> : null}
        </Button>
      ))}
      <Button size="xs" variant="ghost-muted" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </span>
  );
}

/**
 * The Paid lookups row, in Settings and setup. Connect treg by signing in at treg.to (a new tab
 * and a code to match) or by pasting a key: the user's own, or one a team issued them. Connected:
 * switch paid lookups on or off and see this month's spend; a team's owner or admin also sees its
 * balance, tops it up, and reaches its customers.
 */
export function TregSettings() {
  const app = useStore((s) => s.app);
  const [mode, setMode] = useState<"idle" | "paste" | { code: string }>("idle");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const manage = (app?.treg.connected && app.treg.manage) ?? false;
  const team = useTregTeam(manage);
  if (!app) return null;
  const { treg, settings } = app;

  // The new status shows at once, so the row doesn't wait for the state push to change shape.
  const apply = (status: TregStatus) =>
    useStore.setState((st) => (st.app ? { app: { ...st.app, treg: status } } : {}));

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  // Disconnecting also stops a sign-in still waiting for approval.
  const disconnect = () =>
    run(async () => {
      apply(await call("treg.disconnect", {}));
      setMode("idle");
    });
  const shown = error || team.error;

  if (treg.connected)
    return (
      <div className="flex flex-col gap-1.5" data-testid="treg-connected">
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            on={settings.treg}
            onClick={() => void run(() => call("settings.update", { treg: !settings.treg }))}
          >
            {settings.treg ? "On" : "Off"}
          </Chip>
          <span className="text-foreground">
            {treg.issued ? `paid by ${treg.org}` : `team ${treg.org}`}
          </span>
          {treg.issued ? null : <span className="text-muted-foreground text-xs">you pay</span>}
          {team.team ? (
            <>
              <span className="text-muted-foreground text-xs tabular-nums">
                balance {usd(team.team.balanceUsd)}
              </span>
              <TopUp amounts={team.team.billing?.topUps} onError={team.setError} />
            </>
          ) : null}
          <Button size="xs" variant="ghost-muted" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </Button>
        </div>
        <span className="text-muted-foreground text-xs">
          {treg.month.calls
            ? [
                `this install: ${usd(treg.month.usd)} this month`,
                plural(treg.month.calls, "call"),
                ...treg.month.byFeature.map((f) => `${featureLabel(f.feature)} ${usd(f.usd)}`),
              ].join(" · ")
            : "this install: nothing spent this month"}
        </span>
        {team.team ? (
          <span className="text-muted-foreground text-xs">
            {plural(team.team.customers.length, "customer")} ·{" "}
            <Link to="/customers" className="text-foreground underline">
              Manage
            </Link>
          </span>
        ) : null}
        {shown ? <span className="text-destructive-foreground text-xs">{shown}</span> : null}
      </div>
    );

  const hint = (text: string) => <span className="text-muted-foreground text-xs">{text}</span>;
  const failed = error ? (
    <span className="text-destructive-foreground text-xs">{error}</span>
  ) : null;

  if (typeof mode === "object")
    return (
      <div className="flex flex-col gap-1.5" data-testid="treg-waiting">
        <div className="flex items-center gap-2">
          <span className="text-foreground">Waiting for treg</span>
          <code className="rounded-md border px-1.5 font-mono text-xs tracking-widest">
            {mode.code}
          </code>
          <Button size="xs" variant="ghost-muted" onClick={() => void disconnect()}>
            Cancel
          </Button>
        </div>
        {hint("treg shows the same code. Sign in, pick your team, approve.")}
        {failed}
      </div>
    );

  if (mode === "paste")
    return (
      <form
        data-testid="treg-connect"
        className="flex max-w-md flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => apply(await call("treg.connect", { token })));
        }}
      >
        <div className="flex items-center gap-1.5">
          <Input
            size="compact"
            type="password"
            aria-label="treg token"
            placeholder="treg key"
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
          />
          <Button size="xs" type="submit" disabled={busy || !token}>
            {busy ? "Checking" : "Connect"}
          </Button>
          <Button size="xs" variant="ghost-muted" onClick={() => setMode("idle")}>
            Back
          </Button>
        </div>
        {hint("From treg.to, or the one whoever runs your getmyprof gave you.")}
        {failed}
      </form>
    );

  return (
    <div className="flex flex-col gap-1.5" data-testid="treg-start">
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const { code } = await inNewTab(() => call("treg.signIn", {}));
              setMode({ code });
            })
          }
        >
          Connect treg
        </Button>
        <Button size="xs" variant="outline" onClick={() => setMode("paste")}>
          Paste a key
        </Button>
      </div>
      {hint("People search, email finding and checks. Free sources work without it.")}
      {failed}
    </div>
  );
}
