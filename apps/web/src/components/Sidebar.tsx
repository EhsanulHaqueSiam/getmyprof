import type { ThreadSummary } from "@gradcode/contracts";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  Clock3Icon,
  InboxIcon,
  LandmarkIcon,
  MessageCircleQuestionIcon,
  MonitorIcon,
  PlusIcon,
  RepeatIcon,
  RotateCcwIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  UsersIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ago, duration, usd } from "~/lib/format";
import { shelves, snoozePresets } from "~/lib/shelves";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/** Re-renders every 30s so "Working 2m" and "12m" labels stay true without a repainting animation. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function StatusLabel({ t, now }: { t: ThreadSummary; now: number }) {
  if (t.status === "approval")
    return (
      <span className="flex items-center gap-1 text-status-approval">
        <CircleAlertIcon className="size-3" /> Approval
      </span>
    );
  if (t.status === "input")
    return (
      <span className="flex items-center gap-1 text-status-input">
        <MessageCircleQuestionIcon className="size-3" /> Input
      </span>
    );
  if (t.status === "working")
    return (
      <span className="text-status-working">
        Working {t.workingSince ? duration(now - Date.parse(t.workingSince)) : ""}
      </span>
    );
  if (t.status === "failed") return <span className="text-destructive-foreground">Failed</span>;
  if (t.pendingReview > 0)
    return <span className="text-muted-foreground">review {t.pendingReview}</span>;
  return <span className="text-muted-foreground">{ago(t.settledAt ?? t.updatedAt, now)}</span>;
}

function ThreadRow({
  t,
  now,
  active,
  recede,
}: {
  t: ThreadSummary;
  now: number;
  active: boolean;
  recede?: boolean;
}) {
  return (
    <div
      data-testid={`thread-row-${t.id}`}
      className={cn(
        "group/row relative flex h-8 items-center gap-2 rounded-lg pr-1.5 pl-2 transition-[background-color,opacity] duration-150 hover:bg-accent",
        active && "bg-secondary",
        recede && !active && "opacity-60 hover:opacity-100",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          t.unread && !active ? "bg-foreground" : "bg-transparent",
        )}
      />
      <Link
        to="/t/$threadId"
        params={{ threadId: t.id }}
        className={cn(
          "min-w-0 flex-1 truncate text-secondary-label",
          (active || t.unread) && "text-foreground",
          t.unread && !active && "font-semibold",
        )}
      >
        {t.title}
      </Link>
      <span className="text-2xs tabular-nums transition-opacity duration-150 group-hover/row:opacity-0">
        <StatusLabel t={t} now={now} />
      </span>
      <span className="pointer-events-none absolute right-1 flex gap-0.5 bg-accent pl-3 opacity-0 transition-opacity duration-150 group-hover/row:pointer-events-auto group-hover/row:opacity-100">
        {t.settledAt ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-micro"
                  aria-label="Un-settle"
                  onClick={() => void call("threads.settle", { id: t.id, settled: false })}
                >
                  <RotateCcwIcon />
                </Button>
              }
            />
            <TooltipPopup>Un-settle</TooltipPopup>
          </Tooltip>
        ) : (
          <>
            <Menu>
              <MenuTrigger
                render={<Button variant="ghost-muted" size="icon-micro" aria-label="Snooze" />}
              >
                <Clock3Icon />
              </MenuTrigger>
              <MenuPopup align="end">
                {snoozePresets().map((p) => (
                  <MenuItem
                    key={p.label}
                    onClick={() =>
                      void call("threads.snooze", { id: t.id, until: p.until.toISOString() })
                    }
                  >
                    {p.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost-muted"
                    size="icon-micro"
                    aria-label="Settle"
                    onClick={() => void call("threads.settle", { id: t.id, settled: true })}
                  >
                    <CheckIcon />
                  </Button>
                }
              />
              <TooltipPopup>
                Settle <Kbd>E</Kbd>
              </TooltipPopup>
            </Tooltip>
          </>
        )}
      </span>
    </div>
  );
}

function Shelf({
  label,
  items,
  now,
  activeId,
  openByDefault,
  recede,
}: {
  label: string;
  items: ThreadSummary[];
  now: number;
  activeId: string | undefined;
  openByDefault: boolean;
  recede?: boolean;
}) {
  const [open, setOpen] = useState(openByDefault);
  const [ref] = useAutoAnimate<HTMLDivElement>({
    duration: 220,
    easing: "cubic-bezier(0.32, 0.72, 0, 1)",
  });
  // A collapsed shelf still shows the open thread, so it never vanishes from view.
  const shown = open ? items : items.filter((t) => t.id === activeId);
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-muted-foreground text-xs transition-colors hover:text-secondary-label"
      >
        <ChevronDownIcon
          className={cn(
            "size-3 transition-transform duration-200 ease-drawer",
            !open && "-rotate-90",
          )}
        />
        {label}
        <span className="tabular-nums">{items.length}</span>
      </button>
      <div ref={ref} className="flex flex-col gap-px">
        {shown.map((t) => (
          <ThreadRow
            key={t.id}
            t={t}
            now={now}
            active={t.id === activeId}
            {...(recede ? { recede } : {})}
          />
        ))}
      </div>
    </div>
  );
}

function NavLink({
  to,
  icon,
  label,
  count,
  kbd,
  accent,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  count?: number | undefined;
  kbd?: string;
  accent?: boolean;
}) {
  return (
    <Link
      to={to}
      className="flex h-8 items-center gap-2.5 rounded-lg px-2 text-secondary-label transition-colors duration-150 hover:bg-accent hover:text-foreground [&.active]:bg-secondary [&.active]:text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground"
      activeOptions={{ exact: to === "/" }}
    >
      {icon}
      {label}
      {kbd ? <Kbd className="ml-auto bg-transparent">{kbd}</Kbd> : null}
      {count ? (
        <span
          className={cn(
            "ml-auto text-xs tabular-nums",
            accent ? "text-info-foreground" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar() {
  const threads = useStore((s) => s.threads);
  const app = useStore((s) => s.app);
  const live = useStore((s) => s.live);
  const recordsVersion = useStore((s) => s.recordsVersion);
  const setPalette = useStore((s) => s.setPalette);
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const now = useMinuteClock();
  const [mainRef] = useAutoAnimate<HTMLDivElement>({
    duration: 220,
    easing: "cubic-bezier(0.32, 0.72, 0, 1)",
  });
  const [professors, setProfessors] = useState<number | undefined>();
  useEffect(() => {
    void call("records.list", {}).then((r) => setProfessors(r.length));
  }, [recordsVersion]);

  const s = shelves(threads, now);
  const review = threads.reduce((n, t) => n + t.pendingReview, 0);
  const today = threads
    .filter((t) => now - Date.parse(t.updatedAt) < 864e5)
    .reduce((n, t) => n + t.spendUsd, 0);
  const activeId = "threadId" in params ? params.threadId : undefined;

  return (
    <aside className="flex h-dvh min-w-0 flex-col overflow-hidden border-r px-2 pb-2">
      <div className="flex h-12 shrink-0 items-center gap-1.5 pr-1 pl-2">
        <span className="mr-auto font-semibold text-sm tracking-tight">gradcode</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-sm"
                aria-label="Search"
                onClick={() => setPalette(true)}
              />
            }
          >
            <SearchIcon />
          </TooltipTrigger>
          <TooltipPopup>
            Search <Kbd>⌘K</Kbd>
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-sm"
                aria-label="New thread"
                onClick={() => void navigate({ to: "/" })}
              />
            }
          >
            <SquarePenIcon />
          </TooltipTrigger>
          <TooltipPopup>
            New thread <Kbd>⌘N</Kbd>
          </TooltipPopup>
        </Tooltip>
      </div>
      <nav className="flex flex-col gap-px">
        <NavLink to="/" icon={<PlusIcon />} label="New thread" kbd="⌘N" />
        <NavLink to="/professors" icon={<UsersIcon />} label="Professors" count={professors} />
        <NavLink to="/funding" icon={<LandmarkIcon />} label="Funding" />
        <NavLink to="/loops" icon={<RepeatIcon />} label="Loops" />
        <NavLink to="/review" icon={<InboxIcon />} label="Review" count={review} accent />
      </nav>
      <div className="mt-3 flex h-7 items-center gap-1.5 px-2 font-medium text-muted-foreground text-xs">
        <ChevronDownIcon className="size-3" />
        <span className="truncate">{app?.hunt?.name ?? "Your hunt"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={mainRef} className="flex flex-col gap-px">
          {s.main.map((t) => (
            <ThreadRow key={t.id} t={t} now={now} active={t.id === activeId} />
          ))}
        </div>
        <Shelf
          label="Working"
          items={s.working}
          now={now}
          activeId={activeId}
          openByDefault
          recede
        />
        <Shelf
          label="Snoozed"
          items={s.snoozed}
          now={now}
          activeId={activeId}
          openByDefault={false}
        />
        <Shelf
          label="Settled"
          items={s.settled}
          now={now}
          activeId={activeId}
          openByDefault={false}
        />
      </div>
      <div className="flex shrink-0 flex-col gap-px border-t pt-2 text-xs">
        <Link
          to="/settings"
          className="flex h-8 items-center gap-2 rounded-lg px-2 text-secondary-label transition-colors hover:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground"
        >
          <MonitorIcon />
          <span className="truncate">{app?.host.replace(/\.local$/, "") ?? "server"}</span>
          <span
            data-testid="ws-status"
            className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-muted-foreground")}
            aria-label={live ? "connected" : "reconnecting"}
          />
          <SettingsIcon className="ml-auto" />
        </Link>
        <div className="flex h-7 items-center gap-2 px-2 text-muted-foreground">
          today{" "}
          <span className="text-secondary-label tabular-nums">{today ? usd(today) : "$0"}</span>
          <span className="ml-auto tabular-nums">cap {usd(app?.settings.budget.perDay ?? 0)}</span>
        </div>
      </div>
    </aside>
  );
}
