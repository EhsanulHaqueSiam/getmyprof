import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AgentCards } from "~/components/AgentCards";
import { BackupSettings } from "~/components/BackupSettings";
import { HubSettings } from "~/components/HubSettings";
import { MailSettings } from "~/components/MailSettings";
import { McpEndpoint, McpServers } from "~/components/McpSettings";
import { NotifySettings } from "~/components/NotifySettings";
import { PairSettings } from "~/components/PairSettings";
import { TregSettings } from "~/components/TregSettings";
import { Chip } from "~/components/FormParts";
import { Input } from "~/components/ui/input";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/settings")({ component: SettingsPage });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-1.5 border-b py-3 text-sm md:grid-cols-[180px_minmax(0,1fr)] md:gap-4">
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
        <Input
          key={i}
          type="number"
          min="1"
          className="w-14"
          defaultValue={days[i]}
          aria-label={`Follow-up ${i + 1}, business days`}
          onBlur={(e) => void set(i, Number(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      ))}
      business days, then they stop
    </span>
  );
}

/** Pick exactly one of a setting's values; the group ignores a click that would clear it. */
function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <ToggleGroup
      size="xs"
      value={[value]}
      onValueChange={(v) => {
        const next = options.find(([o]) => o === v[0]);
        if (next) onChange(next[0]);
      }}
      aria-label={label}
    >
      {options.map(([o, text]) => (
        <Toggle key={o} value={o}>
          {text}
        </Toggle>
      ))}
    </ToggleGroup>
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
          <Pick
            label="Detail"
            value={s.detail}
            options={[
              ["brief", "Brief"],
              ["std", "Standard"],
              ["deep", "Deep"],
            ]}
            onChange={(detail) => void save({ detail })}
          />
        </Row>
        <Row label="First emails">
          <Pick
            label="First emails"
            value={s.firstEmails}
            options={[
              ["own", "Your words"],
              ["agent", "Full assist"],
            ]}
            onChange={(firstEmails) => void save({ firstEmails })}
          />
        </Row>
        <Row label="Agents">
          <div className="w-full">
            <AgentCards />
          </div>
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
              <Input
                type="number"
                step="0.01"
                min="0"
                className="w-16"
                defaultValue={s.budget[k]}
                aria-label={label}
                onBlur={(e) => void save({ budget: { ...s.budget, [k]: Number(e.target.value) } })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              {label}
            </label>
          ))}
        </Row>
        <Row label="Paid lookups (treg)">
          <TregSettings />
        </Row>
        <Row label="OpenAlex key">
          <label className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <Input
              type="password"
              className="w-56"
              defaultValue={s.openalexKey}
              aria-label="OpenAlex key"
              placeholder="optional"
              onBlur={(e) => void save({ openalexKey: e.target.value.trim() })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            Free at openalex.org. Without one, OpenAlex allows about 90 professor lookups a day.
          </label>
        </Row>
        <Row label="Profile from">
          <Pick
            label="Profile from"
            value={s.profileSource}
            options={
              app.adapters.hq
                ? [
                    ["app", "This app"],
                    ["hq", "hq vault"],
                  ]
                : [["app", "This app"]]
            }
            onChange={(profileSource) => void save({ profileSource })}
          />
        </Row>
        {app.adapters.gradhunt ? (
          <Row label="gradhunt sync">
            <Chip on={s.gradhunt} onClick={() => void save({ gradhunt: !s.gradhunt })}>
              {s.gradhunt ? "On" : "Off"}
            </Chip>
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
        <Row label="Counselor and shared catalog">
          <HubSettings />
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
