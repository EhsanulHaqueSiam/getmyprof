import type { HubStatus } from "@getmyprof/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Chip } from "~/components/FormParts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { since } from "~/lib/format";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/**
 * Settings' counselor row, both sides. As a student: paste a counselor's invite to send them
 * the progress report, and choose whether to take from and give back to the shared catalog.
 * As a hub: how many students connected here, and where to invite more.
 */
export function HubSettings() {
  const app = useStore((s) => s.app);
  const [status, setStatus] = useState<HubStatus | undefined>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A sync elsewhere (hourly, or another tab) pushes a state change; this follows it.
  useEffect(() => {
    void call("hub.status", {}).then(setStatus);
  }, [app]);
  const act = async (work: () => Promise<HubStatus>) => {
    setError("");
    setBusy(true);
    try {
      setStatus(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const hub = (
    <span className="text-muted-foreground">
      Students: {app?.counts.students ?? 0} ·{" "}
      <Link to="/students" className="text-foreground hover:underline">
        Invite
      </Link>
    </span>
  );
  if (status === undefined) return hub;

  if (status === null)
    return (
      <div className="flex max-w-xl flex-col gap-1.5 text-xs">
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void act(() => call("hub.connect", { code: code.trim() }));
          }}
        >
          <Input
            size="compact"
            className="w-72"
            aria-label="Invite code"
            placeholder="Paste a counselor's invite code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" size="xs" variant="outline" disabled={!code.trim() || busy}>
            {busy ? "Connecting" : "Connect to hub"}
          </Button>
        </form>
        <span className="text-muted-foreground">
          Shares your progress report: counts, your shortlist, replies and the next 30 days. Never
          your facts, CV, drafts, emails or notes.
        </span>
        {error ? <span className="text-destructive-foreground">{error}</span> : null}
        {hub}
      </div>
    );

  return (
    <div className="flex max-w-xl flex-col gap-2 text-xs" data-testid="hub-member">
      <span className="text-secondary-label">
        Connected to <span className="text-foreground">{status.host}</span> ·{" "}
        {status.lastSent ? `report sent ${since(status.lastSent)}` : "report not sent yet"}
      </span>
      {status.lastError ? (
        <span className="text-warning-foreground">{status.lastError}</span>
      ) : null}
      <span className="flex flex-wrap items-center gap-2">
        <Chip
          on={status.takeCatalog}
          onClick={() =>
            void act(() => call("hub.setMember", { takeCatalog: !status.takeCatalog }))
          }
        >
          Take from the shared catalog
        </Chip>
        <span className="text-muted-foreground">
          New facts go to To file and Review, never straight in.
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Chip
          on={status.giveBack}
          onClick={() => void act(() => call("hub.setMember", { giveBack: !status.giveBack }))}
        >
          Give back what I accept
        </Chip>
        <span className="text-muted-foreground">
          Never your facts, drafts, replies, fit or notes.
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void act(() => call("hub.syncNow", {}))}
        >
          {busy ? "Syncing" : "Sync now"}
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => void act(() => call("hub.disconnect", {}))}
        >
          Disconnect
        </Button>
      </span>
      {error ? <span className="text-destructive-foreground">{error}</span> : null}
      {hub}
    </div>
  );
}
