import type { DetailLevel, Professor, ScopeItem } from "@gradcode/contracts";
import {
  ArrowUpIcon,
  AtSignIcon,
  FileTextIcon,
  PaperclipIcon,
  SquareIcon,
  WalletIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Kbd } from "~/components/ui/kbd";
import { guessKind, toBase64 } from "~/lib/files";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/** A model id like "claude-opus-5-5" as the label "Opus 5.5". */
export const modelLabel = (id: string) =>
  id
    .replace("claude-", "")
    .replace(/-(\d)-(\d)$/, " $1.$2")
    .replace(/^\w/, (c) => c.toUpperCase());

const DETAIL_LABEL = { brief: "Brief", std: "Standard", deep: "Deep" } as const;
const NEXT_DETAIL = { brief: "std", std: "deep", deep: "brief" } as const;

type Props = {
  placeholder: string;
  working?: boolean;
  /** delivery: normal send, queued after the next tool call, or steered in now. */
  /** attachments: vault document ids the composer uploaded for this message. */
  /** scope: professors and schools this message names with @. */
  onSend: (
    text: string,
    delivery: "send" | "queued" | "steered",
    attachments: string[],
    scope: ScopeItem[],
  ) => void;
  onStop?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
  /** What the thread is already about, shown as the @ chip. */
  scope?: ScopeItem[];
  /** @ mentions to start with, e.g. from "Ask about Lybarger". */
  mentions?: ScopeItem[];
  /** Start in Ask mode. */
  ask?: boolean;
  /** A thread's own detail level; without it the toggle sets the install's. */
  detail?: { value: DetailLevel; set: (d: DetailLevel) => void };
};

const NONE: ScopeItem[] = [];

/** A name as the @ chip shows it: a professor's last name, a school's full name. */
const short = (x: ScopeItem) =>
  x.kind === "professor" ? (x.name.split(" ").at(-1) ?? x.name) : x.name;
const sameItem = (a: ScopeItem, b: ScopeItem) =>
  a.kind === b.kind &&
  (a.kind === "professor" && b.kind === "professor" ? a.key === b.key : a.name === b.name);

/** The "@query" being typed just before the caret, or null. */
const mentionQuery = (before: string) => /(?:^|\s)@([^@\n]{0,40})$/.exec(before)?.[1] ?? null;

/** Professors and schools in the sheet that match what follows "@". */
function matches(people: Professor[], query: string) {
  const q = query.trim().toLowerCase();
  const hit = (s: string) => s.toLowerCase().includes(q);
  const profs = people
    .filter((p) => hit(p.name) || hit(p.university))
    .slice(0, 6)
    .map((p) => ({
      item: { kind: "professor", key: p.key, name: p.name } as ScopeItem,
      sub: p.university,
    }));
  const schools = [...new Set(people.map((p) => p.university))]
    .filter(hit)
    .slice(0, 3)
    .map((u) => ({ item: { kind: "school", name: u } as ScopeItem, sub: "school" }));
  return [...profs, ...schools];
}

/**
 * The message box. Enter sends; while the agent works Enter queues and ⌘Enter steers.
 * ⌘. stops the turn. @ names a professor or school from the sheet, scoping the message to it.
 * Grows with its text up to a third of the screen.
 */
export function Composer({
  placeholder,
  working = false,
  onSend,
  onStop,
  autoFocus,
  compact,
  scope = NONE,
  mentions: initialMentions = NONE,
  ask: initialAsk = false,
  detail,
}: Props) {
  const [text, setText] = useState(() => initialMentions.map((m) => `@${m.name} `).join(""));
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  // Ask: a free, read-only question; the server reads the "[ask]" tag and gates every tool.
  const [ask, setAsk] = useState(initialAsk);
  const [mentions, setMentions] = useState<ScopeItem[]>(initialMentions);
  // The sheet, loaded the first time someone types @.
  const [people, setPeople] = useState<Professor[] | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const options = query !== null && people ? matches(people, query) : [];
  const [uploading, setUploading] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const settings = useStore((s) => s.app?.settings);
  const saveSettings = useStore((s) => s.saveSettings);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight / 3)}px`;
  }, [text]);

  const submit = (steer: boolean) => {
    const t = text.trim();
    if (!t) return;
    onSend(
      ask ? `[ask] ${t}` : t,
      working ? (steer ? "steered" : "queued") : "send",
      files.map((f) => f.id),
      // Only what the message still names.
      mentions.filter((m) => t.includes(`@${m.name}`)),
    );
    setText("");
    setFiles([]);
    setMentions([]);
    setQuery(null);
  };

  /** Follows the caret: typing "@" and a few letters opens the picker. */
  const track = (value: string, caret: number) => {
    const q = mentionQuery(value.slice(0, caret));
    setQuery(q);
    setActive(0);
    if (q !== null && !people) void call("records.list", {}).then(setPeople);
  };

  /** Swaps the "@query" before the caret for the picked name. */
  const pick = (item: ScopeItem) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^@\n]{0,40})$/, `@${item.name} `);
    setText(before + text.slice(caret));
    setMentions((m) => (m.some((x) => sameItem(x, item)) ? m : [...m, item]));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };
  const chip = [...scope, ...mentions.filter((m) => !scope.some((s) => sameItem(s, m)))];

  /** Attached files go to the vault first (deduped there), then ride along by id. */
  const attach = async (list: FileList) => {
    for (const file of list) {
      setUploading((n) => n + 1);
      try {
        const doc = await call("documents.upload", {
          name: file.name,
          kind: guessKind(file.name, "other"),
          mime: file.type || "application/octet-stream",
          base64: await toBase64(file),
          expires: null,
        });
        setFiles((f) =>
          f.some((x) => x.id === doc.id) ? f : [...f, { id: doc.id, name: doc.name }],
        );
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  return (
    <div className="relative rounded-[20px] border border-input bg-popover shadow-composer">
      {options.length ? (
        <div
          role="listbox"
          aria-label="Professors and schools"
          className="absolute bottom-full left-2 z-20 mb-1.5 w-80 rounded-xl border border-input bg-popover p-1 shadow-composer"
        >
          {options.map((o, i) => (
            <button
              key={o.item.kind === "professor" ? o.item.key : `school:${o.item.name}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.item);
              }}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs",
                i === active ? "bg-accent text-foreground" : "text-secondary-label",
              )}
            >
              <span className="truncate">{o.item.name}</span>
              <span className="ml-auto truncate text-muted-foreground">{o.sub}</span>
            </button>
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="flex flex-wrap gap-1 px-3 pt-2.5" data-testid="attachments">
          {files.map((f) => (
            <span
              key={f.id}
              className="flex h-6 items-center gap-1 rounded-md border border-input pl-2 text-secondary-label text-xs"
            >
              {f.name}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))}
                className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        ref={ref}
        value={text}
        rows={compact ? 1 : 2}
        // biome-style autofocus: the composer is the page's primary input.
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          track(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (options.length) {
            const pickKey = e.key === "Enter" || e.key === "Tab";
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || pickKey || e.key === "Escape")
              e.preventDefault();
            if (e.key === "ArrowDown") return setActive((a) => (a + 1) % options.length);
            if (e.key === "ArrowUp")
              return setActive((a) => (a - 1 + options.length) % options.length);
            if (e.key === "Escape") return setQuery(null);
            const chosen = options[active];
            if (pickKey && chosen) return pick(chosen.item);
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit(e.metaKey || e.ctrlKey);
          }
          if (e.key === "." && (e.metaKey || e.ctrlKey) && working) {
            e.preventDefault();
            onStop?.();
          }
        }}
        placeholder={placeholder}
        aria-label="Message"
        className={cn(
          "block w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-placeholder",
          compact ? "pb-1" : "pb-1.5",
        )}
      />
      <div className="flex items-center gap-0.5 px-2 pt-1 pb-2 text-muted-foreground text-xs">
        <label
          className="flex size-6.5 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-accent hover:text-foreground"
          title="Attach files (they're kept in the Vault)"
        >
          <input
            type="file"
            multiple
            aria-label="Attach files"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void attach(e.target.files);
              e.target.value = "";
            }}
          />
          <PaperclipIcon className="size-3.5" />
        </label>
        {uploading ? <span className="px-1">attaching</span> : null}
        {!compact && settings ? (
          <>
            <span className="flex h-6.5 items-center gap-1.5 rounded-lg px-2">
              {modelLabel(settings.model)}
            </span>
            <button
              type="button"
              aria-pressed={ask}
              title="Ask answers from what it can read: it changes nothing and spends nothing"
              onClick={() => setAsk(!ask)}
              className="flex h-6.5 items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
            >
              <ZapIcon /> {ask ? "Ask" : "Hunt"}
            </button>
            <button
              type="button"
              title={detail ? "This thread's detail" : "Detail for new threads"}
              onClick={() =>
                detail
                  ? detail.set(NEXT_DETAIL[detail.value])
                  : void saveSettings({ detail: NEXT_DETAIL[settings.detail] })
              }
              className="flex h-6.5 items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
            >
              <FileTextIcon /> {DETAIL_LABEL[detail?.value ?? settings.detail]}
            </button>
            <span className="flex h-6.5 items-center gap-1.5 rounded-lg px-2 [&_svg]:size-3.5">
              <WalletIcon /> ${settings.budget.perThread.toFixed(2)} cap
            </span>
            {chip.length ? (
              <span
                data-testid="scope-chip"
                title={chip.map((x) => x.name).join(", ")}
                className="flex h-6.5 min-w-0 items-center gap-1 rounded-lg px-2 text-secondary-label [&_svg]:size-3.5"
              >
                <AtSignIcon className="shrink-0" />
                <span className="truncate">{chip.map(short).join(", ")}</span>
              </span>
            ) : null}
          </>
        ) : null}
        {working ? (
          <span className="ml-auto mr-2 hidden items-center gap-1 sm:flex">
            <Kbd className="bg-transparent">↵</Kbd> queue · <Kbd className="bg-transparent">⌘↵</Kbd>{" "}
            steer
          </span>
        ) : null}
        {working && !text.trim() ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={onStop}
            className={cn(
              "flex size-7.5 items-center justify-center rounded-full border border-input text-foreground transition-transform active:scale-95",
              !working && "ml-auto",
            )}
          >
            <SquareIcon className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!text.trim()}
            onClick={() => submit(false)}
            className={cn(
              "flex size-7.5 items-center justify-center rounded-full bg-foreground text-background transition-[transform,opacity] active:scale-95 disabled:opacity-30",
              !working && "ml-auto",
            )}
          >
            <ArrowUpIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
