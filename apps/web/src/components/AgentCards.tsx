import { AGENT_NAME, type AgentInfo, modelKey } from "@getmyprof/contracts";
import { CheckIcon, ChevronDownIcon, CopyIcon, StarIcon } from "lucide-react";
import { useState } from "react";
import { AgentMark } from "~/components/AgentPicker";
import { ClaudeConnect } from "~/components/ClaudeConnect";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const DOT: Record<AgentInfo["state"], string> = {
  ready: "bg-success",
  signin: "bg-warning",
  missing: "bg-muted-foreground",
  unsupported: "bg-muted-foreground",
  checking: "bg-muted-foreground",
};

/**
 * Settings' and Setup's agent list: each agent with its sign-in, an on/off switch, the default
 * mark, and (opened) which of its models the picker shows and which are starred.
 */
export function AgentCards() {
  const app = useStore((s) => s.app);
  const saveSettings = useStore((s) => s.saveSettings);
  const [open, setOpen] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  if (!app) return null;
  const { settings } = app;
  const toggleIn = <T extends string>(list: T[], key: T) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  return (
    <div className="space-y-2" id="agents">
      {app.agents.map((a) => {
        const off = settings.agentsOff.includes(a.kind);
        const isDefault = settings.agent === a.kind;
        const opened = open === a.kind && a.models.length > 0;
        return (
          <div
            key={a.kind}
            className="rounded-lg border px-3 py-2.5"
            data-testid={`agent-${a.kind}`}
          >
            <div className="flex items-center gap-2.5">
              <AgentMark kind={a.kind} size="lg" />
              <button
                type="button"
                disabled={!a.models.length}
                onClick={() => setOpen(opened ? null : a.kind)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5 font-semibold text-sm">
                  {AGENT_NAME[a.kind]}
                  {isDefault ? <Badge variant="outline">Default</Badge> : null}
                  {a.models.length ? (
                    <ChevronDownIcon
                      className={cn(
                        "size-3.5 text-muted-foreground transition-transform",
                        opened && "rotate-180",
                      )}
                    />
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <span className={cn("size-1.5 shrink-0 rounded-full", DOT[a.state])} />
                  <span className="truncate">{a.detail}</span>
                </div>
              </button>
              {a.state === "ready" && !isDefault && !off ? (
                <Button
                  variant="ghost-muted"
                  size="xs"
                  onClick={() => {
                    // Its own default, unless that's hidden from the picker: then the first shown.
                    const shown = (id: string) =>
                      !settings.hiddenModels.includes(modelKey(a.kind, id));
                    const model = shown(a.defaultModel)
                      ? a.defaultModel
                      : (a.models.find((m) => shown(m.id))?.id ?? a.defaultModel);
                    void saveSettings({ agent: a.kind, model, effort: "" });
                  }}
                >
                  Make default
                </Button>
              ) : null}
              <button
                type="button"
                role="switch"
                aria-checked={!off}
                aria-label={`${AGENT_NAME[a.kind]} ${off ? "off" : "on"}`}
                disabled={isDefault}
                title={
                  isDefault
                    ? "The default agent stays on"
                    : off
                      ? "Off: left out of the picker"
                      : "On"
                }
                onClick={() =>
                  void saveSettings({ agentsOff: toggleIn(settings.agentsOff, a.kind) })
                }
                className={cn(
                  "relative h-4.5 w-8 shrink-0 rounded-full transition-colors disabled:opacity-60",
                  off ? "bg-input" : "bg-primary",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-3.5 rounded-full bg-background transition-[left]",
                    off ? "left-0.5" : "left-4",
                  )}
                />
              </button>
            </div>
            {a.kind === "claude" && a.state !== "ready" ? (
              <div className="mt-2 text-xs">
                <ClaudeConnect claude={app.claude} />
              </div>
            ) : a.fix ? (
              <Fix command={a.fix} />
            ) : null}
            {opened ? (
              <div className="mt-2.5 border-t pt-2">
                <p className="mb-1 text-muted-foreground text-xs">Models in the picker</p>
                {a.models.map((m) => {
                  const key = modelKey(a.kind, m.id);
                  const hidden = settings.hiddenModels.includes(key);
                  const fav = settings.favoriteModels.includes(key);
                  return (
                    <div key={m.id} className="flex items-center gap-2 py-1 text-xs">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={!hidden}
                        aria-label={`Show ${m.name} in the picker`}
                        onClick={() =>
                          void saveSettings({ hiddenModels: toggleIn(settings.hiddenModels, key) })
                        }
                        className={cn(
                          "grid size-3.5 place-items-center rounded border",
                          !hidden && "border-foreground bg-foreground text-background",
                        )}
                      >
                        {hidden ? null : <CheckIcon className="size-2.5" />}
                      </button>
                      <span
                        className={cn("min-w-0 flex-1 truncate", hidden && "text-muted-foreground")}
                      >
                        {m.name}
                      </span>
                      <button
                        type="button"
                        aria-label={fav ? "Remove from favorites" : "Add to favorites"}
                        onClick={() =>
                          void saveSettings({
                            favoriteModels: toggleIn(settings.favoriteModels, key),
                          })
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <StarIcon className={cn("size-3", fav && "fill-current text-warning")} />
                      </button>
                    </div>
                  );
                })}
                {a.binary ? (
                  <p className="mt-1.5 text-muted-foreground text-xs">
                    Runs <code>{a.binary}</code>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-muted-foreground text-xs">
          Each agent uses the copy signed in on this machine, read-only: file edits and commands are
          refused.
        </p>
        <Button
          variant="outline"
          size="xs"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void call("agents.refresh", {}).finally(() => setChecking(false));
          }}
        >
          {checking ? "Checking" : "Check again"}
        </Button>
      </div>
    </div>
  );
}

/** The command that installs or signs an agent in, with a copy button. */
function Fix({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Run in a terminal:</span>
      <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5">{command}</code>
      <Button
        variant="ghost-muted"
        size="icon-xs"
        aria-label="Copy command"
        onClick={() => {
          void navigator.clipboard.writeText(command);
          setCopied(true);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}
