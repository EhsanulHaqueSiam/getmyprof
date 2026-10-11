import { Popover } from "@base-ui/react/popover";
import {
  AGENT_NAME,
  type AgentInfo,
  type AgentKind,
  modelKey,
  type ThreadSummary,
} from "@getmyprof/contracts";
import { Link } from "@tanstack/react-router";
import { BrainIcon, CheckIcon, ChevronDownIcon, SearchIcon, StarIcon } from "lucide-react";
import { useState } from "react";
import { Kbd } from "~/components/ui/kbd";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/** Each agent's mark in the rail and the trigger: a letter, since brand marks aren't ours. */
const MARK: Record<AgentKind, string> = {
  claude: "C",
  codex: "X",
  opencode: "O",
  gemini: "G",
  copilot: "P",
  cursor: "U",
};

export function AgentMark({ kind, size = "sm" }: { kind: AgentKind; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center bg-secondary font-bold text-foreground",
        size === "lg" ? "size-5.5 rounded-md text-xs" : "size-4 rounded text-[10px]",
      )}
    >
      {MARK[kind]}
    </span>
  );
}

/** A thread's agent, model and effort; without one the picker sets what new threads start on. */
export type Picked = {
  agent: AgentKind;
  model: string;
  effort: string;
  /** After a thread's first message: the agent can't change, the model can. */
  locked: boolean;
  set: (p: { agent: AgentKind; model: string; effort: string }) => void;
};

export type AgentThread = Pick<ThreadSummary, "id" | "agent" | "model" | "effort">;

/** What a thread runs on once its first message fixed it; else what new threads start on. */
function usePicked(thread: AgentThread | undefined): Picked | null {
  const settings = useStore((s) => s.app?.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  if (thread?.agent)
    return {
      agent: thread.agent,
      model: thread.model ?? "",
      effort: thread.effort ?? "",
      locked: true,
      set: (p) =>
        void call("threads.setModel", { id: thread.id, model: p.model, effort: p.effort }),
    };
  if (!settings) return null;
  return {
    agent: settings.agent,
    model: settings.model,
    effort: settings.effort,
    locked: false,
    set: (p) => void saveSettings(p),
  };
}

const modelName = (agents: AgentInfo[], kind: AgentKind, id: string) =>
  agents.find((a) => a.kind === kind)?.models.find((m) => m.id === id)?.name ?? id;

/**
 * The composer's agent and model picker: agents in a rail, the picked one's models beside it,
 * Favorites across agents, search over all of them, and ⌘1 to ⌘9 for the rows.
 */
export function AgentPicker({ thread }: { thread?: AgentThread | undefined }) {
  const app = useStore((s) => s.app);
  const picked = usePicked(thread);
  const saveSettings = useStore((s) => s.saveSettings);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<AgentKind | "favorites">(picked?.agent ?? "claude");
  const [q, setQ] = useState("");
  if (!app || !picked) return null;
  const { settings } = app;
  const agents = app.agents.filter((a) => !settings.agentsOff.includes(a.kind));
  const favorites = settings.favoriteModels;
  const shown = (a: AgentInfo) =>
    a.models.filter((m) => !settings.hiddenModels.includes(modelKey(a.kind, m.id)));
  const all = agents.flatMap((a) => shown(a).map((m) => ({ agent: a.kind, ...m })));
  const rows = q.trim()
    ? all.filter((m) =>
        `${m.name} ${m.id} ${AGENT_NAME[m.agent]}`.toLowerCase().includes(q.trim().toLowerCase()),
      )
    : view === "favorites"
      ? all.filter((m) => favorites.includes(modelKey(m.agent, m.id)))
      : all.filter((m) => m.agent === view);
  const current = agents.find((a) => a.kind === view);
  const blocked = (k: AgentKind) => picked.locked && k !== picked.agent;
  const waiting = agents.filter((a) => a.state === "signin" || a.state === "missing");

  const choose = (agent: AgentKind, model: string) => {
    if (blocked(agent)) return;
    picked.set({ agent, model, effort: agent === picked.agent ? picked.effort : "" });
    setOpen(false);
    setQ("");
  };
  const star = (key: string) =>
    void saveSettings({
      favoriteModels: favorites.includes(key)
        ? favorites.filter((f) => f !== key)
        : [...favorites, key],
    });

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setView(picked.agent);
      }}
    >
      <Popover.Trigger
        data-testid="agent-picker"
        title="Agent and model"
        className="flex h-6.5 min-w-0 items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <AgentMark kind={picked.agent} />
        <span className="truncate">{modelName(app.agents, picked.agent, picked.model)}</span>
        <ChevronDownIcon className="size-3 opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6} className="z-[130]">
          <Popover.Popup
            className="dropdown-glass flex max-h-[346px] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-lg shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)] outline-none"
            onKeyDown={(e) => {
              const n = Number(e.key);
              if ((e.metaKey || e.ctrlKey) && n >= 1 && n <= 9 && rows[n - 1]) {
                e.preventDefault();
                choose(rows[n - 1]!.agent, rows[n - 1]!.id);
              }
            }}
          >
            <div className="flex w-11 shrink-0 flex-col gap-1 bg-muted/40 p-1" aria-label="Agents">
              <RailButton
                on={view === "favorites"}
                label="Favorites"
                onClick={() => setView("favorites")}
              >
                <StarIcon className="size-4.5 fill-current" />
              </RailButton>
              <div className="mx-0.5 border-b" />
              {agents.map((a) => (
                <RailButton
                  key={a.kind}
                  on={view === a.kind}
                  dim={a.state !== "ready" || blocked(a.kind)}
                  dot={a.state === "signin" ? "warn" : a.state === "missing" ? "none" : undefined}
                  label={
                    blocked(a.kind)
                      ? `${AGENT_NAME[a.kind]}: start a new thread to use it`
                      : `${AGENT_NAME[a.kind]} · ${a.detail}`
                  }
                  onClick={() => setView(a.kind)}
                >
                  <AgentMark kind={a.kind} size="lg" />
                </RailButton>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <label className="flex items-center gap-2 border-b px-2.5 py-2 text-muted-foreground text-xs">
                <SearchIcon className="size-3.5" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && rows[0]) choose(rows[0].agent, rows[0].id);
                  }}
                  placeholder="Search models..."
                  aria-label="Search models"
                  className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-placeholder"
                />
              </label>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {!q.trim() && current && current.state !== "ready" ? (
                  <NotReady agent={current} />
                ) : rows.length === 0 ? (
                  <p className="px-2 py-3 text-muted-foreground text-xs">
                    {view === "favorites" && !q.trim()
                      ? "Star a model to keep it here."
                      : "No models found"}
                  </p>
                ) : (
                  rows.map((m, i) => {
                    const key = modelKey(m.agent, m.id);
                    const on = m.agent === picked.agent && m.id === picked.model;
                    const across = view === "favorites" || q.trim() !== "";
                    return (
                      <div
                        key={key}
                        role="option"
                        aria-selected={on}
                        aria-disabled={blocked(m.agent)}
                        tabIndex={0}
                        onClick={() => choose(m.agent, m.id)}
                        onKeyDown={(e) => e.key === "Enter" && choose(m.agent, m.id)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none hover:bg-accent focus-visible:bg-accent",
                          on && "bg-accent",
                          blocked(m.agent) && "cursor-not-allowed opacity-45",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-xs">{m.name}</div>
                          {across ? (
                            <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
                              <AgentMark kind={m.agent} />
                              {AGENT_NAME[m.agent]}
                            </div>
                          ) : null}
                        </div>
                        {on ? <CheckIcon className="size-3.5 shrink-0" /> : null}
                        {i < 9 ? <Kbd>⌘{i + 1}</Kbd> : null}
                        <button
                          type="button"
                          aria-label={
                            favorites.includes(key) ? "Remove from favorites" : "Add to favorites"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            star(key);
                          }}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <StarIcon
                            className={cn(
                              "size-3",
                              favorites.includes(key) && "fill-current text-warning",
                            )}
                          />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              {waiting.length ? (
                <p className="border-t px-3 py-2 text-muted-foreground text-xs">
                  {new Intl.ListFormat("en").format(waiting.map((a) => AGENT_NAME[a.kind]))}{" "}
                  {waiting.length === 1 ? "isn't" : "aren't"} ready.{" "}
                  <Link
                    to="/settings"
                    hash="agents"
                    className="text-foreground underline underline-offset-2"
                  >
                    Set up
                  </Link>
                </p>
              ) : null}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RailButton({
  on,
  dim,
  dot,
  label,
  onClick,
  children,
}: {
  on: boolean;
  dim?: boolean;
  dot?: "warn" | "none" | undefined;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "relative grid aspect-square place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent",
        on &&
          "text-foreground after:absolute after:top-1/2 after:-right-1 after:h-5 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-foreground",
        dim && "opacity-45",
      )}
    >
      {children}
      {dot ? (
        <span
          className={cn(
            "absolute right-1 bottom-1 size-1.5 rounded-full",
            dot === "warn" ? "bg-warning" : "bg-muted-foreground",
          )}
        />
      ) : null}
    </button>
  );
}

/** An agent that can't run yet: why, and the command that fixes it. */
function NotReady({ agent }: { agent: AgentInfo }) {
  return (
    <div className="space-y-2 px-2 py-2 text-xs">
      <p className="text-muted-foreground">
        {AGENT_NAME[agent.kind]}: {agent.detail}.
      </p>
      {agent.fix ? (
        <p>
          Run in a terminal: <code className="rounded bg-muted px-1 py-0.5">{agent.fix}</code>
        </p>
      ) : null}
    </div>
  );
}

const EFFORT_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

/** The reasoning chip: only the levels the picked agent takes, hidden when it takes none. */
export function EffortPicker({ thread }: { thread?: AgentThread | undefined }) {
  const app = useStore((s) => s.app);
  const picked = usePicked(thread);
  const efforts = app?.agents.find((a) => a.kind === picked?.agent)?.efforts ?? [];
  if (!picked || !efforts.length) return null;
  return (
    <Menu>
      <MenuTrigger
        data-testid="effort-picker"
        title="Reasoning effort"
        className="flex h-6.5 items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground [&_svg]:size-3.5"
      >
        <BrainIcon />
        {EFFORT_LABEL[picked.effort] ?? (picked.effort || "Default")}
        <ChevronDownIcon className="size-3! opacity-60" />
      </MenuTrigger>
      <MenuPopup side="top" align="start">
        <MenuRadioGroup
          value={picked.effort}
          onValueChange={(v: string) =>
            picked.set({ agent: picked.agent, model: picked.model, effort: v })
          }
        >
          <MenuRadioItem value="">Default</MenuRadioItem>
          {efforts.map((e) => (
            <MenuRadioItem key={e} value={e}>
              {EFFORT_LABEL[e] ?? e}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
