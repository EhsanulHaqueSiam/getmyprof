import { ROW_OPS, type RowOp } from "@gradcode/contracts";
import { useState } from "react";
import { Chip } from "~/components/FormParts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { usd } from "~/lib/format";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/** A spend ledger feature tag in words: hunt, loop, or a row action's name. */
const featureLabel = (f: string) =>
  f.startsWith("row-") && f.slice(4) in ROW_OPS ? ROW_OPS[f.slice(4) as RowOp].label : `${f}s`;

/**
 * The Paid lookups row, in Settings and setup: connect the treg token issued for this install
 * (pinned to its customer id), switch paid lookups on or off, and see this month's spend.
 */
export function TregSettings() {
  const app = useStore((s) => s.app);
  const [form, setForm] = useState({ customer: "", token: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!app) return null;
  const { treg, settings } = app;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
          <span className="text-foreground">{treg.customer}</span>
          <span className="text-muted-foreground text-xs">
            {treg.month.calls
              ? `${usd(treg.month.usd)} this month · ${treg.month.calls} call${treg.month.calls === 1 ? "" : "s"}`
              : "nothing spent this month"}
          </span>
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={busy}
            onClick={() => void run(() => call("treg.disconnect", {}))}
          >
            Disconnect
          </Button>
        </div>
        {treg.month.byFeature.length ? (
          <span className="text-muted-foreground text-xs">
            {treg.month.byFeature
              .map((f) => `${featureLabel(f.feature)} ${usd(f.usd)}`)
              .join(" · ")}
          </span>
        ) : null}
        {error ? <span className="text-destructive-foreground text-xs">{error}</span> : null}
      </div>
    );

  return (
    <form
      data-testid="treg-connect"
      className="flex max-w-md flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => call("treg.connect", form));
      }}
    >
      <Input
        size="compact"
        aria-label="Customer id"
        placeholder="Customer id, e.g. cust_8123"
        value={form.customer}
        onChange={(e) => setForm({ ...form, customer: e.target.value.trim() })}
      />
      <Input
        size="compact"
        type="password"
        aria-label="treg token"
        placeholder="treg token issued for this install"
        value={form.token}
        onChange={(e) => setForm({ ...form, token: e.target.value.trim() })}
      />
      <span className="text-muted-foreground text-xs">
        People search, email finding and checks, billed to this customer. Without it, only free
        sources and emails printed on official pages.
      </span>
      {error ? <span className="text-destructive-foreground text-xs">{error}</span> : null}
      <div>
        <Button size="xs" type="submit" disabled={busy || !form.customer || !form.token}>
          {busy ? "Checking" : "Connect"}
        </Button>
      </div>
    </form>
  );
}
