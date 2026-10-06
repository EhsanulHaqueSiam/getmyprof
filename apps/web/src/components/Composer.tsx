import { ArrowUpIcon, FileTextIcon, SquareIcon, WalletIcon, ZapIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Kbd } from "~/components/ui/kbd";
import { cn } from "~/lib/utils";
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
  onSend: (text: string, delivery: "send" | "queued" | "steered") => void;
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
    onSend(t, working ? (steer ? "steered" : "queued") : "send");
    setText("");
  };

  return (
    <div className="rounded-[20px] border border-input bg-popover shadow-composer">
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
        {!compact && settings ? (
          <>
            <span className="flex h-6.5 items-center gap-1.5 rounded-lg px-2">
              {modelLabel(settings.model)}
            </span>
            <span className="flex h-6.5 items-center gap-1.5 rounded-lg px-2 [&_svg]:size-3.5">
              <ZapIcon /> Hunt
            </span>
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
