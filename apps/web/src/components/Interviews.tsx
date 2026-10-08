import type { Application, Program } from "@gradcode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { download } from "~/lib/files";
import { interviewIcs } from "~/lib/vault";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const save = (value: Application) => void call("vault.save", { kind: "application", value });

/** "Dec 10, 9:30 AM" for a local "2026-12-10T09:30". */
const when = (at: string) =>
  new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * An application's interviews. Each gets a private prep pack, a calendar file, and a thank-you
 * the agent drafts into the Pipeline afterwards. Adding one moves the application to "interview".
 */
export function Interviews({
  app,
  program,
  named,
}: {
  app: Application;
  program: Program | undefined;
  named: string[];
}) {
  const navigate = useNavigate();
  const setNotice = useStore((s) => s.setNotice);
  const writing = useStore((s) => s.vault)?.writing ?? [];
  const [who, setWho] = useState("");
  const [at, setAt] = useState("");
  const openThread = (t: { id: string }) =>
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  const fail = (e: unknown) => setNotice(e instanceof Error ? e.message : String(e));

  return (
    <div className="flex flex-col gap-1" data-testid="interviews">
      {app.interviews.map((i) => {
        const prep = writing.find(
          (w) => w.kind === "prep" && w.programId === app.programId && w.title.endsWith(i.with),
        );
        return (
          <div key={i.id} className="flex flex-wrap items-center gap-2">
            <span className="w-36 truncate text-foreground">{i.with}</span>
            <span className="w-28 text-muted-foreground">{when(i.at)}</span>
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() =>
                prep
                  ? void navigate({ to: "/vault/writing/$id", params: { id: prep.id } })
                  : void call("writing.start", {
                      kind: "prep",
                      programId: app.programId,
                      scholarshipId: null,
                      basedOn: null,
                      about: i.with,
                    })
                      .then(openThread)
                      .catch(fail)
              }
            >
              {prep ? "Prep pack" : "Write prep pack"}
            </Button>
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() =>
                download(
                  `interview-${i.with.replace(/\W+/g, "-").toLowerCase()}.ics`,
                  interviewIcs(i, program?.university ?? ""),
                  "text/calendar",
                )
              }
            >
              Calendar
            </Button>
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() =>
                void call("interviews.thank", { applicationId: app.id, interviewId: i.id })
                  .then(openThread)
                  .catch(fail)
              }
            >
              Thank-you
            </Button>
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Remove interview with ${i.with}`}
              onClick={() =>
                save({ ...app, interviews: app.interviews.filter((x) => x.id !== i.id) })
              }
            >
              <Trash2Icon />
            </Button>
          </div>
        );
      })}
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!who.trim() || !at) return;
          const early = ["planning", "in-progress", "submitted"].includes(app.status);
          save({
            ...app,
            status: early ? "interview" : app.status,
            interviews: [...app.interviews, { id: crypto.randomUUID(), with: who.trim(), at }],
          });
          setWho("");
          setAt("");
        }}
      >
        <input
          value={who}
          onChange={(e) => setWho(e.target.value)}
          list={`named-${app.id}`}
          placeholder="Interview with"
          aria-label="Interview with"
          className="h-6.5 w-36 rounded-md border border-input bg-transparent px-2 outline-none placeholder:text-placeholder"
        />
        <datalist id={`named-${app.id}`}>
          {named.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <input
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          aria-label="Interview time"
          className="h-6.5 rounded-md border border-input bg-background px-1.5 text-foreground outline-none"
        />
        <Button type="submit" size="icon-xs" variant="ghost-muted" aria-label="Add interview">
          <PlusIcon />
        </Button>
      </form>
    </div>
  );
}
