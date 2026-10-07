import type { Conversation, OutreachMessage } from "@gradcode/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { act, ChannelBadge, TOUCH_LABEL } from "~/components/Pipeline";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { nextStep, openDraft, sequence, theirTime } from "~/lib/outreach";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";

function Bubble({ m, name }: { m: OutreachMessage; name: string }) {
  const mine = m.direction === "out";
  const head = mine
    ? m.status === "scheduled"
      ? `Queued · ${theirTime(m)}`
      : `You · ${theirTime(m)} · ${m.touch ? TOUCH_LABEL[m.touch] : ""}`
    : `${name} · ${m.at ? new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}`;
  return (
    <div
      data-testid="message"
      className={cn(
        "max-w-[78%] animate-fade-up rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
        mine ? "self-end bg-accent" : "self-start border",
        m.status === "scheduled" && "opacity-70",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <ChannelBadge channel={m.channel} /> {head}
      </div>
      {m.subject && m.touch !== "reply" && mine ? (
        <div className="font-medium text-xs">{m.subject}</div>
      ) : null}
      <div className="whitespace-pre-wrap text-secondary-label">{m.body}</div>
      {m.status === "scheduled" ? (
        <div className="mt-2 flex justify-end gap-1.5">
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => act(call("outreach.cancel", { id: m.id }))}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => act(call("outreach.sendNow", { id: m.id }))}
          >
            Send now
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A line between messages: what a reply was read as, or why mail came back. */
function Divider({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2.5 text-muted-foreground text-xs before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
      {children}
    </div>
  );
}

/** The open draft: edit it, then schedule or send it. LinkedIn notes are sent by hand. */
function Composer({ draft, connected }: { draft: OutreachMessage; connected: boolean }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const dirty = subject !== draft.subject || body !== draft.body;
  const save = () => (dirty ? call("outreach.edit", { id: draft.id, subject, body }) : null);
  const then = (next: () => Promise<unknown>) => act(Promise.resolve(save()).then(next));
  const slot = draft.channel === "email" && draft.touch !== "reply";
  const send = () => then(() => call("outreach.sendNow", { id: draft.id }));

  return (
    <div
      data-testid="composer"
      className="mx-4 mb-4 rounded-2xl border bg-card shadow-composer focus-within:border-ring/40"
    >
      {draft.touch !== "reply" && draft.channel === "email" ? (
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={() => void save()}
          aria-label="Subject"
          placeholder="Subject"
          className="w-full border-b bg-transparent px-3.5 py-2 text-sm outline-none placeholder:text-placeholder"
        />
      ) : null}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.metaKey || e.ctrlKey) &&
            connected &&
            draft.channel === "email"
          )
            send();
        }}
        aria-label="Message"
        rows={8}
        className="block w-full resize-none bg-transparent px-3.5 py-2.5 text-sm leading-relaxed outline-none"
      />
      <div className="flex items-center gap-1.5 px-2.5 pb-2.5 text-muted-foreground text-xs">
        <ChannelBadge channel={draft.channel} />
        <span className="truncate">
          {draft.touch ? TOUCH_LABEL[draft.touch] : ""} · to {draft.to}
          {draft.status === "failed" ? ` · not sent: ${draft.note}` : ""}
        </span>
        <Button
          size="xs"
          variant="ghost-muted"
          className="ml-auto"
          onClick={() => act(call("outreach.cancel", { id: draft.id }))}
        >
          Discard
        </Button>
        {draft.channel === "linkedin" ? (
          <>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                then(async () => {
                  await navigator.clipboard.writeText(body);
                  window.open(draft.to, "_blank", "noopener");
                })
              }
            >
              Copy and open LinkedIn
            </Button>
            <Button size="xs" onClick={() => act(call("outreach.markSent", { id: draft.id }))}>
              Mark sent
            </Button>
          </>
        ) : connected ? (
          <>
            {slot ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => then(() => call("outreach.approve", { ids: [draft.id] }))}
              >
                Schedule
              </Button>
            ) : null}
            <Button size="xs" onClick={send}>
              Send now <Kbd className="bg-transparent text-primary-foreground/60">⌘↵</Kbd>
            </Button>
          </>
        ) : (
          <Link to="/settings" className="text-info-foreground underline">
            Connect a mailbox to send
          </Link>
        )}
      </div>
    </div>
  );
}

/** One professor's thread of mail: messages, the open draft, and the sequence beside it. */
export function ConversationView({ c, connected }: { c: Conversation; connected: boolean }) {
  const draft = openDraft(c);
  const r = c.record;
  // Drafts and failed sends live in the composer, not the transcript.
  const shown = c.messages.filter(
    (m) => m.status !== "cancelled" && m.status !== "draft" && m.status !== "failed",
  );
  return (
    <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4 text-sm">
          <Link
            to="/professors/$key"
            params={{ key: r.key }}
            className="shrink-0 whitespace-nowrap font-semibold hover:underline"
          >
            {r.name}
          </Link>
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
            {[r.university, r.niche].filter(Boolean).join(" · ")}
          </span>
          <span className="flex shrink-0 gap-2.5 whitespace-nowrap text-xs tabular-nums">
            {r.fit ? (
              <span className={r.fit >= 4 ? "text-success-foreground" : "text-secondary-label"}>
                fit {r.fit}
              </span>
            ) : null}
            {r.moneyTier ? (
              <span className="text-secondary-label">money tier {r.moneyTier}</span>
            ) : null}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {shown.map((m) => (
            <div key={m.id} className="flex flex-col gap-3">
              <Bubble m={m} name={r.name} />
              {m.direction === "in" && m.replyClass ? (
                <Divider>
                  {`reply read as ${m.replyClass.replace("-", " ")}${m.note ? `, ${m.note}` : ""}${draft?.touch === "reply" ? " · answer drafted below" : ""}`}
                </Divider>
              ) : null}
              {m.kind === "auto-reply" ? (
                <Divider>{`out of office${m.note ? ` · ${m.note}` : ""} · follow-ups wait`}</Divider>
              ) : null}
              {m.kind === "bounce" ? <Divider>bounced · find another address</Divider> : null}
            </div>
          ))}
          {shown.length === 0 ? (
            <div className="m-auto text-muted-foreground text-xs">Nothing sent yet.</div>
          ) : null}
        </div>
        {draft ? (
          <Composer
            key={`${draft.id}:${draft.subject}:${draft.body}`}
            draft={draft}
            connected={connected}
          />
        ) : null}
      </div>
      <aside className="min-h-0 overflow-y-auto border-l px-4 py-3 text-xs">
        <div className="mb-1.5 text-muted-foreground">Professor</div>
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {(
            [
              ["Money", r.money],
              ["Lasts", r.lasts],
              ["Contact", r.contact],
              ["Email", r.email ? `${r.email}${r.emailCheck ? ` · ${r.emailCheck}` : ""}` : ""],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words text-secondary-label">{v || "?"}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 mb-1.5 text-muted-foreground">Sequence</div>
        <ol className="flex flex-col gap-1.5" data-testid="sequence">
          {sequence(c).map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  s.state === "done" && "bg-success",
                  s.state === "now" && "bg-status-approval",
                  (s.state === "later" || s.state === "off") && "bg-muted-foreground/50",
                )}
              />
              <span className={s.state === "off" ? "text-muted-foreground" : "text-foreground"}>
                {s.label}
              </span>
              <span
                className={cn(
                  "ml-auto truncate pl-2",
                  s.state === "now" ? "text-status-approval" : "text-muted-foreground",
                )}
              >
                {s.when}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 mb-1.5 text-muted-foreground">Next</div>
        <p className="text-secondary-label" data-testid="next-step">
          {nextStep(c)}
        </p>
      </aside>
    </div>
  );
}
