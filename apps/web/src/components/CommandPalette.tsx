import type { Professor } from "@gradcode/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CornerDownLeftIcon,
  InboxIcon,
  LandmarkIcon,
  MessageSquareIcon,
  PlusIcon,
  RepeatIcon,
  SendIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

type Item = { id: string; icon: ReactNode; label: string; hint: string; run: () => void };

/** ⌘K: every view, thread and professor, filtered as you type. Arrows move, Enter opens. */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPalette);
  const threads = useStore((s) => s.threads);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [people, setPeople] = useState<Professor[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    void call("records.list", {}).then(setPeople);
  }, [open]);

  const go = (to: string, params?: Record<string, string>) => () => {
    setOpen(false);
    void navigate({ to, ...(params ? { params } : {}) });
  };

  const all: Item[] = [
    { id: "new", icon: <PlusIcon />, label: "New thread", hint: "⌘N", run: go("/") },
    { id: "prof", icon: <UsersIcon />, label: "Professors", hint: "view", run: go("/professors") },
    { id: "fund", icon: <LandmarkIcon />, label: "Funding", hint: "view", run: go("/funding") },
    { id: "pipe", icon: <SendIcon />, label: "Pipeline", hint: "view", run: go("/pipeline") },
    { id: "loops", icon: <RepeatIcon />, label: "Loops", hint: "view", run: go("/loops") },
    { id: "review", icon: <InboxIcon />, label: "Review", hint: "view", run: go("/review") },
    {
      id: "settings",
      icon: <SettingsIcon />,
      label: "Settings",
      hint: "view",
      run: go("/settings"),
    },
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
  ];
  const q = query.trim().toLowerCase();
  const items = (q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all).slice(0, 40);

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
          placeholder="Go to a view, thread or professor"
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
