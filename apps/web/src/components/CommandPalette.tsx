import { type LoopRow, type Professor, ROW_OPS, type RowOp } from "@getmyprof/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  CalendarIcon,
  CheckIcon,
  ContactIcon,
  CornerDownLeftIcon,
  FileTextIcon,
  GraduationCapIcon,
  PlayIcon,
  ZapIcon,
  InboxIcon,
  LandmarkIcon,
  MessageSquareIcon,
  PlusIcon,
  RepeatIcon,
  SendIcon,
  ArchiveIcon,
  SettingsIcon,
  TableIcon,
  TextSearchIcon,
  UserIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { snoozePresets } from "~/lib/shelves";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

type Item = { id: string; icon: ReactNode; label: string; hint: string; run: () => void };

/**
 * ⌘K: every view, thread, professor and school, and the actions: answer an approval, accept all
 * of Review, approve the Pipeline's drafts, run a loop, sync mail, ask about someone, and on a
 * thread settle, snooze or run a row action on its rows. Filtered as you type; arrows, Enter.
 */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPalette);
  const threads = useStore((s) => s.threads);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [people, setPeople] = useState<Professor[]>([]);
  const [loops, setLoops] = useState<LoopRow[]>([]);
  // Select stable state and derive below: a selector that builds a new array loops forever.
  const conversations = useStore((s) => s.conversations);
  const views = useStore((s) => s.views);
  const drafts = conversations.flatMap((c) => c.messages).filter((m) => m.status === "draft");
  const mailbox = useStore((s) => s.app?.mail.connected ?? false);
  const manage = useStore((s) => s.app?.treg.manage ?? false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const here = /^\/t\/([^/]+)$/.exec(path)?.[1];
  const hereRows = (here ? views[here]?.rows : undefined) ?? [];
  const [said, setSaid] = useState<{ threadId: string; title: string; snippet: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    void call("records.list", {}).then(setPeople);
    void call("loops.list", {}).then(setLoops);
  }, [open]);

  // Past three letters, also search what was said inside threads (debounced).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSaid([]);
      return;
    }
    const t = setTimeout(() => void call("threads.search", { q }).then(setSaid), 150);
    return () => clearTimeout(t);
  }, [query]);

  const go = (to: string, params?: Record<string, string>) => () => {
    setOpen(false);
    void navigate({ to, ...(params ? { params } : {}) });
  };
  /** Closes the palette, then does the work. */
  const act = (work: () => Promise<unknown>) => () => {
    setOpen(false);
    void work();
  };
  const reviewing = threads.filter((t) => t.pendingReview > 0);
  const tomorrow = snoozePresets().find((p) => p.label === "Tomorrow morning");

  const actions: Item[] = [
    ...threads
      .filter((t) => t.status === "approval")
      .map((t) => ({
        id: `approve-${t.id}`,
        icon: <ZapIcon />,
        label: `Answer the approval in ${t.title}`,
        hint: "↵ allows there",
        run: go("/t/$threadId", { threadId: t.id }),
      })),
    ...(reviewing.length
      ? [
          {
            id: "accept-all",
            icon: <CheckIcon />,
            label: `Accept everything in Review (${reviewing.reduce((n, t) => n + t.pendingReview, 0)})`,
            hint: "action",
            run: act(async () => {
              const opened = await Promise.all(
                reviewing.map((t) => call("threads.view", { id: t.id })),
              );
              const ids = opened.flatMap((v) =>
                v.proposals.filter((p) => p.status === "pending").map((p) => p.id),
              );
              if (ids.length) await call("proposals.resolve", { ids, decision: "accept" });
            }),
          },
        ]
      : []),
    ...(drafts.length
      ? [
          {
            id: "approve-drafts",
            icon: <SendIcon />,
            label: `Approve the Pipeline's drafts (${drafts.length})`,
            hint: "action",
            run: act(() => call("outreach.approve", { ids: drafts.map((m) => m.id) })),
          },
        ]
      : []),
    ...(mailbox
      ? [
          {
            id: "sync",
            icon: <InboxIcon />,
            label: "Sync mail now",
            hint: "action",
            run: act(() => call("mail.sync", {})),
          },
        ]
      : []),
    ...loops.map((l) => ({
      id: `run-${l.id}`,
      icon: <PlayIcon />,
      label: `Run ${l.name}`,
      hint: "loop",
      run: act(async () => {
        const t = await call("loops.run", { id: l.id });
        void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
      }),
    })),
    ...(here
      ? [
          ...(threads.find((t) => t.id === here)?.settledAt
            ? []
            : [
                {
                  id: "settle",
                  icon: <CheckIcon />,
                  label: "Settle this thread",
                  hint: "e",
                  run: act(() => call("threads.settle", { id: here, settled: true })),
                },
              ]),
          ...(tomorrow
            ? [
                {
                  id: "snooze",
                  icon: <RepeatIcon />,
                  label: "Snooze this thread until tomorrow morning",
                  hint: "s",
                  run: act(() =>
                    call("threads.snooze", { id: here, until: tomorrow.until.toISOString() }),
                  ),
                },
              ]
            : []),
          ...(hereRows.length
            ? (Object.keys(ROW_OPS) as RowOp[]).map((op) => ({
                id: `row-${op}`,
                icon: <TableIcon />,
                label: `${ROW_OPS[op].label} on this thread's ${hereRows.length === 1 ? "row" : `${hereRows.length} rows`}`,
                hint: "row action",
                run: act(() =>
                  call("threads.rowAction", {
                    id: here,
                    op,
                    keys: hereRows.map((r) => r.key),
                  }),
                ),
              }))
            : []),
        ]
      : []),
  ];

  const all: Item[] = [
    { id: "new", icon: <PlusIcon />, label: "New thread", hint: "⌘N", run: go("/") },
    {
      id: "students",
      icon: <UsersRoundIcon />,
      label: "Students",
      hint: "view",
      run: go("/students"),
    },
    { id: "prof", icon: <UsersIcon />, label: "Professors", hint: "view", run: go("/professors") },
    {
      id: "schools",
      icon: <GraduationCapIcon />,
      label: "Schools",
      hint: "view",
      run: go("/schools"),
    },
    { id: "cal", icon: <CalendarIcon />, label: "Calendar", hint: "view", run: go("/calendar") },
    { id: "fund", icon: <LandmarkIcon />, label: "Funding", hint: "view", run: go("/funding") },
    { id: "pipe", icon: <SendIcon />, label: "Pipeline", hint: "view", run: go("/pipeline") },
    {
      id: "report",
      icon: <FileTextIcon />,
      label: "Progress report",
      hint: "view",
      run: go("/report"),
    },
    { id: "vault", icon: <ArchiveIcon />, label: "Vault", hint: "view", run: go("/vault") },
    { id: "loops", icon: <RepeatIcon />, label: "Loops", hint: "view", run: go("/loops") },
    ...(manage
      ? [
          {
            id: "customers",
            icon: <ContactIcon />,
            label: "Customers",
            hint: "view",
            run: go("/customers"),
          },
        ]
      : []),
    { id: "review", icon: <InboxIcon />, label: "Review", hint: "view", run: go("/review") },
    {
      id: "settings",
      icon: <SettingsIcon />,
      label: "Settings",
      hint: "view",
      run: go("/settings"),
    },
    ...[...new Set(people.map((p) => p.university))].map((u) => ({
      id: `school-${u}`,
      icon: <GraduationCapIcon />,
      label: u,
      hint: "school",
      run: () => {
        setOpen(false);
        void navigate({ to: "/professors", search: { school: u } });
      },
    })),
    ...threads.map((t) => ({
      id: t.id,
      icon: <MessageSquareIcon />,
      label: t.title,
      hint: "thread",
      run: go("/t/$threadId", { threadId: t.id }),
    })),
    ...people.map((p) => ({
      id: p.key,
      icon: <UserIcon />,
      label: `${p.name} · ${p.university}`,
      hint: "professor",
      run: go("/professors/$key", { key: p.key }),
    })),
    ...actions,
    ...people.map((p) => ({
      id: `ask-${p.key}`,
      icon: <MessageSquareIcon />,
      label: `Ask about ${p.name}`,
      hint: "action",
      run: () => {
        setOpen(false);
        void navigate({ to: "/", search: { about: p.key, name: p.name } });
      },
    })),
  ];
  const q = query.trim().toLowerCase();
  const byName = q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all;
  const inThreads: Item[] = said
    .filter((s) => !byName.some((i) => i.id === s.threadId))
    .map((s) => ({
      id: `said-${s.threadId}`,
      icon: <TextSearchIcon />,
      label: `${s.title} · "${s.snippet}"`,
      hint: "said in thread",
      run: go("/t/$threadId", { threadId: s.threadId }),
    }));
  const items = [...byName, ...inThreads].slice(0, 40);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="max-w-xl overflow-hidden p-0" showCloseButton={false}>
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, items.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter") items[index]?.run();
          }}
          placeholder="Go anywhere, do anything, or search what was said"
          aria-label="Command"
          className="h-12 w-full border-b bg-transparent px-4 text-sm outline-none placeholder:text-placeholder"
        />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setIndex(i)}
              onClick={item.run}
              className={cn(
                "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
                i === index && "bg-accent",
              )}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                {i === index ? <CornerDownLeftIcon className="size-3.5" /> : item.hint}
              </span>
            </button>
          ))}
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-muted-foreground text-xs">
              Nothing matches.
            </div>
          ) : null}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
