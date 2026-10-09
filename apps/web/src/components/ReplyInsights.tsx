import type { Conversation } from "@getmyprof/contracts";
import { plural } from "~/lib/format";
import { MIN_FOR_RATE, rate, replyInsights } from "~/lib/insights";

/**
 * The Pipeline's Replies view: of the first emails sent, how many got an answer, by way in,
 * length, money tier and the professor's weekday. Counts with a rate, never a promise.
 */
export function ReplyInsights({ conversations }: { conversations: Conversation[] }) {
  const r = replyInsights(conversations);
  if (r.sent === 0)
    return <div className="m-auto text-muted-foreground text-xs">No first emails sent yet.</div>;
  const sections = [
    ["By way in", r.byHook],
    ["By length", r.byLength],
    ["By money tier", r.byTier],
    ["By day sent, their time", r.byWeekday],
  ] as const;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex max-w-[420px] flex-col gap-3.5 px-4 py-3 text-[12.5px]">
        <h2 className="flex items-baseline gap-2 font-semibold text-sm">
          Replies
          <span className="font-normal text-muted-foreground text-xs tabular-nums">
            {r.replied} of {plural(r.sent, "first email")}
            {rate(r)}
          </span>
        </h2>
        {sections.map(([title, buckets]) => (
          <section key={title} data-testid="reply-section">
            <h3 className="mb-1 font-medium text-muted-foreground text-xs">{title}</h3>
            {buckets.map((b) => (
              <div
                key={b.label}
                className="flex items-baseline gap-2.5 border-b py-1.5 text-secondary-label last:border-b-0"
              >
                {b.label}
                <span className="ml-auto whitespace-nowrap text-2xs text-muted-foreground tabular-nums">
                  {b.replied} of {b.sent}
                  {rate(b)}
                </span>
              </div>
            ))}
          </section>
        ))}
        <p className="text-2xs text-muted-foreground">
          Groups under {MIN_FOR_RATE} emails are too small to read much into.
        </p>
      </div>
    </div>
  );
}
