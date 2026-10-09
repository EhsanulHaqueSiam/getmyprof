import { type OutreachMessage, voiceMarks } from "@getmyprof/contracts";
import { type ComponentProps, type ReactNode, useRef, useState } from "react";
import { act } from "~/components/Pipeline";
import { Button } from "~/components/ui/button";
import { plural } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";

/**
 * A textarea that underlines model-voice phrases in place (MODEL_VOICE); the reason for each is
 * in the draft's issues list. A copy of the text sits behind the textarea, transparent except
 * for its underlines, and scrolls with it.
 */
export function VoiceTextarea({
  value,
  className,
  onScroll,
  ...props
}: ComponentProps<"textarea"> & { value: string }) {
  const back = useRef<HTMLDivElement>(null);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of voiceMarks(value)) {
    parts.push(value.slice(at, m.start));
    parts.push(
      <span
        key={m.start}
        className="underline decoration-warning decoration-wavy underline-offset-4"
      >
        {value.slice(m.start, m.end)}
      </span>,
    );
    at = m.end;
  }
  parts.push(value.slice(at), "\n");
  return (
    <div className="relative">
      <div
        ref={back}
        aria-hidden
        className={cn(
          className,
          "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent",
        )}
      >
        {parts}
      </div>
      <textarea
        {...props}
        value={value}
        className={cn(className, "relative")}
        onScroll={(e) => {
          if (back.current) back.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
      />
    </div>
  );
}

/**
 * "Your words" on a first email the agent suggested: the applicant writes why them in their own
 * words and the agent rebuilds the draft around them, fixing only facts and citations; or they
 * take the agent's version below as it is.
 */
export function OwnWords({ draft }: { draft: OutreachMessage }) {
  const [text, setText] = useState(draft.ownWords);
  // Sent to the agent, and the draft hasn't come back yet.
  const fixing = draft.ownWords.trim() !== "";
  return (
    <div className="border-b px-3.5 py-2.5" data-testid="own-words">
      <div className="mb-1 text-muted-foreground text-xs">
        In your words: why them, what you'd do. Two to four lines, any English. The agent's version
        is below.
      </div>
      <VoiceTextarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Your words"
        rows={3}
        className="block w-full resize-none rounded-lg border bg-transparent px-2.5 py-1.5 text-sm leading-relaxed outline-none"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          size="xs"
          disabled={!text.trim() || (fixing && text === draft.ownWords)}
          onClick={() => act(call("outreach.ownWords", { id: draft.id, text }))}
        >
          Fix facts only
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => act(call("outreach.useAgentVersion", { id: draft.id }))}
        >
          Use the agent's version
        </Button>
        {fixing && text === draft.ownWords ? (
          <span className="text-muted-foreground text-xs">The agent is fixing your lines</span>
        ) : null}
      </div>
    </div>
  );
}

/** What the agent changed in the applicant's own lines, line by line, and why. */
export function Fixes({ fixes }: { fixes: OutreachMessage["fixes"] }) {
  return (
    <details className="border-b px-3.5 py-2 text-xs" data-testid="fixes">
      <summary className="cursor-pointer text-muted-foreground">
        Your words, with {plural(fixes.length, "change")} by the agent
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {fixes.map((f) => (
          <li key={f.from}>
            <div className="text-destructive-foreground line-through">{f.from}</div>
            <div className="text-success-foreground">{f.to}</div>
            <div className="text-muted-foreground">{f.why}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}
