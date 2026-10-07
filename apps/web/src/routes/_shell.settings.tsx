import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { modelLabel } from "~/components/Composer";
import { BackupSettings } from "~/components/BackupSettings";
import { MailSettings } from "~/components/MailSettings";
import { McpEndpoint, McpServers } from "~/components/McpSettings";
import { NotifySettings } from "~/components/NotifySettings";
import { PairSettings } from "~/components/PairSettings";
import { TregSettings } from "~/components/TregSettings";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/settings")({ component: SettingsPage });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-4 border-b py-3 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** When follow-ups 1 and 2 go out: business days after the first email, saved with the hunt. */
function FollowUpSettings() {
  const hunt = useStore((s) => s.app?.hunt);
  if (!hunt) return null;
  const days = hunt.prefs.followUpDays;
  const set = async (i: 0 | 1, value: number) => {
    if (!Number.isInteger(value) || value < 1 || value === days[i]) return;
    const next: [number, number] = i === 0 ? [value, days[1]] : [days[0], value];
    const saved = await call("hunt.save", {
      name: hunt.name,
      prefs: { ...hunt.prefs, followUpDays: next },
    });
    useStore.setState((st) => (st.app ? { app: { ...st.app, hunt: saved } } : {}));
  };
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
      after
      {([0, 1] as const).map((i) => (
        <input
          key={i}
          type="number"
          min="1"
          defaultValue={days[i]}
          aria-label={`Follow-up ${i + 1}, business days`}
          onBlur={(e) => void set(i, Number(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-7 w-12 rounded-lg border border-input bg-transparent px-2 text-foreground outline-none"
        />
      ))}
      business days, then they stop
    </span>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-7 rounded-lg border px-2.5 text-xs transition-colors",
        on
          ? "border-transparent bg-accent text-foreground"
          : "border-input text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SettingsPage() {
  const app = useStore((s) => s.app);
  const save = useStore((s) => s.saveSettings);
  if (!app) return <div className="flex-1" />;
  const s = app.settings;
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="max-w-3xl px-8 py-6">
        <h1 className="font-semibold text-lg tracking-tight">Settings</h1>
        <p className="mt-0.5 mb-3 text-muted-foreground text-xs">
          Your hunt and profile live in{" "}
          <Link to="/setup" className="underline">
            setup
          </Link>
          .
        </p>
        <Row label="Detail">
          {(["brief", "std", "deep"] as const).map((d) => (
            <Toggle key={d} on={s.detail === d} onClick={() => void save({ detail: d })}>
              {{ brief: "Brief", std: "Standard", deep: "Deep" }[d]}
            </Toggle>
          ))}
        </Row>
        <Row label="Model">
          {["claude-opus-5-5", "claude-sonnet-5-5"].map((m) => (
            <Toggle key={m} on={s.model === m} onClick={() => void save({ model: m })}>
              {modelLabel(m)}
            </Toggle>
          ))}
        </Row>
        <Row label="Budget">
          {(
            [
              ["perThread", "a thread"],
              ["perLoopRun", "a loop run"],
              ["perDay", "a day"],
              ["askOver", "ask above"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 text-muted-foreground text-xs">
              $
              <input
                type="number"
                step="0.01"
                min="0"
                defaultValue={s.budget[k]}
                aria-label={label}
                onBlur={(e) => void save({ budget: { ...s.budget, [k]: Number(e.target.value) } })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="h-7 w-16 rounded-lg border border-input bg-transparent px-2 text-foreground outline-none"
              />
              {label}
            </label>
          ))}
        </Row>
        <Row label="Paid lookups (treg)">
          <TregSettings />
        </Row>
        <Row label="Profile from">
          <Toggle
            on={s.profileSource === "app"}
            onClick={() => void save({ profileSource: "app" })}
          >
            This app
          </Toggle>
          {app.adapters.hq ? (
            <Toggle
              on={s.profileSource === "hq"}
              onClick={() => void save({ profileSource: "hq" })}
            >
              hq vault
            </Toggle>
          ) : null}
        </Row>
        {app.adapters.gradhunt ? (
          <Row label="gradhunt sync">
            <Toggle on={s.gradhunt} onClick={() => void save({ gradhunt: !s.gradhunt })}>
              {s.gradhunt ? "On" : "Off"}
            </Toggle>
          </Row>
        ) : null}
        <Row label="Mailbox">
          <MailSettings />
        </Row>
        {app.hunt ? (
          <Row label="Follow-ups">
            <FollowUpSettings />
          </Row>
        ) : null}
        <Row label="Notifications">
          <NotifySettings />
        </Row>
        <Row label="MCP servers">
          <McpServers />
        </Row>
        <Row label="For other agents">
          <McpEndpoint />
        </Row>
        <Row label="Your data">
          <BackupSettings />
        </Row>
        <Row label="Open on your phone">
          <PairSettings />
        </Row>
        <Row label="Runs on">
          <span className="text-secondary-label">{app.host}</span>
        </Row>
      </div>
    </div>
  );
}
