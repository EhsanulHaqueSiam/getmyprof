import {
  ArrowUpIcon,
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
  onSend: (text: string, delivery: "send" | "queued" | "steered", attachments: string[]) => void;
  onStop?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
};

/**
 * The message box. Enter sends; while the agent works Enter queues and ⌘Enter steers.
 * ⌘. stops the turn. Grows with its text up to a third of the screen.
 */
export function Composer({
  placeholder,
  working = false,
  onSend,
  onStop,
  autoFocus,
  compact,
}: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  // Ask: a free, read-only question; the server reads the "[ask]" tag and gates every tool.
  const [ask, setAsk] = useState(false);
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
    );
    setText("");
    setFiles([]);
  };

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
    <div className="rounded-[20px] border border-input bg-popover shadow-composer">
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
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
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
              onClick={() => void saveSettings({ detail: NEXT_DETAIL[settings.detail] })}
              className="flex h-6.5 items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
            >
              <FileTextIcon /> {DETAIL_LABEL[settings.detail]}
            </button>
            <span className="flex h-6.5 items-center gap-1.5 rounded-lg px-2 [&_svg]:size-3.5">
              <WalletIcon /> ${settings.budget.perThread.toFixed(2)} cap
            </span>
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
