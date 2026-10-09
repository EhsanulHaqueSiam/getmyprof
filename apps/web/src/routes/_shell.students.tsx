import type { HubStudent } from "@getmyprof/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Td } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { since } from "~/lib/format";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/students")({ component: StudentsPage });

// A bare YYYY-MM-DD is a calendar day, not UTC midnight, so it never shows a day early.
const day = (s: string) =>
  new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const WEEK = 7 * 864e5;
const HEAD: [string, string][] = [
  ["Student", ""],
  ["Hunt", ""],
  ["Next deadline", ""],
  ["Schools", "kept · tiers"],
  ["Professors", "found · emailed · replied"],
  ["Synced", ""],
];

/** This hub's students with their latest reports. */
function useStudents() {
  const app = useStore((s) => s.app);
  const [students, setStudents] = useState<HubStudent[] | null>(null);
  // A report landing pushes a state change, so the table follows.
  useEffect(() => {
    void call("hub.students", {}).then(setStudents);
  }, [app]);
  return students;
}

/** Makes an invite: a name and where students reach this hub, then the code, once. */
function Invite({ onClose }: { onClose: () => void }) {
  const tailnet = useStore((s) => s.app?.tailnet);
  const [name, setName] = useState("");
  const [url, setUrl] = useState(() => (tailnet?.served ? tailnet.url : window.location.origin));
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  if (code)
    return (
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">Invite for {code.name}, shown once:</span>
        <code className="max-w-full select-all break-all font-mono text-2xs text-foreground">
          {code.code}
        </code>
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(code.code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <span className="text-muted-foreground">
          They paste it in Settings, Counselor and shared catalog.
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Hide the invite"
          className="ml-auto"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5 text-xs"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          setCode({ name, ...(await call("hub.invite", { name, url })) });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="their name"
        aria-label="Student name"
        className="h-6.5 w-40 rounded-md border border-input bg-transparent px-1.5 text-foreground outline-none placeholder:text-placeholder"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Where students reach this hub"
        className="h-6.5 w-72 rounded-md border border-input bg-transparent px-1.5 font-mono text-2xs text-foreground outline-none"
      />
      <Button size="xs" type="submit" disabled={!name.trim()}>
        Make invite
      </Button>
      <Button size="xs" variant="ghost-muted" onClick={onClose}>
        Cancel
      </Button>
      {error ? <span className="text-destructive-foreground">{error}</span> : null}
    </form>
  );
}

/** The first dated step ahead, in warning tone within a week. */
function NextDeadline({ s, now }: { s: HubStudent; now: number }) {
  const next = s.report?.upcoming[0];
  if (!s.report) return <span className="text-muted-foreground">no report yet</span>;
  if (!next) return <span className="text-muted-foreground">none in 30 days</span>;
  const soon = new Date(`${next.date}T12:00:00`).getTime() - now < WEEK;
  return (
    <span className={soon ? "text-warning-foreground" : ""}>
      {day(next.date)} · {next.title}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 pt-3">
      <h2 className="mb-1 font-medium text-muted-foreground text-xs">{title}</h2>
      {children}
    </div>
  );
}

function Line({ text, at }: { text: string; at: string }) {
  return (
    <div className="flex items-baseline gap-2 py-1 text-[13px]">
      <span className="min-w-0 flex-1 truncate text-secondary-label">{text}</span>
      <span className="shrink-0 text-muted-foreground text-xs">{day(at)}</span>
    </div>
  );
}

/** The selected student: their next 30 days and replies, the full report, and Remove. */
function StudentPanel({ s }: { s: HubStudent }) {
  const [removing, setRemoving] = useState(false);
  const r = s.report;
  return (
    <aside className="flex min-w-0 flex-col border-l pb-4" data-testid="student-panel">
      <div className="flex h-12 items-baseline gap-2 px-4 pt-4 text-sm">
        <span className="font-semibold">{s.name}</span>
        <span className="truncate text-muted-foreground text-xs">{r?.hunt ?? "no report yet"}</span>
      </div>
      {r ? (
        <>
          <Section title="Next 30 days">
            {r.upcoming.length ? (
              r.upcoming.map((u) => <Line key={u.date + u.title} text={u.title} at={u.date} />)
            ) : (
              <p className="text-muted-foreground text-xs">Nothing due.</p>
            )}
          </Section>
          <Section title="Replies">
            {r.replies.length ? (
              r.replies.map((x) => (
                <Line
                  key={x.name + x.at}
                  text={`${x.name}${x.note ? `: ${x.note}` : " replied"}`}
                  at={x.at}
                />
              ))
            ) : (
              <p className="text-muted-foreground text-xs">No replies yet.</p>
            )}
          </Section>
        </>
      ) : null}
      <div className="flex flex-wrap gap-1.5 px-4 pt-4">
        {r ? (
          <Button
            size="xs"
            variant="outline"
            render={<Link to="/students/$id" params={{ id: s.id }} />}
          >
            Open full report
          </Button>
        ) : null}
        <Button
          size="xs"
          variant={removing ? "destructive-outline" : "ghost-muted"}
          onClick={() => (removing ? void call("hub.remove", { id: s.id }) : setRemoving(true))}
        >
          {removing ? `Remove ${s.name}` : "Remove"}
        </Button>
      </div>
    </aside>
  );
}

/**
 * A counselor's students: everyone whose install connected to this one as their hub, one row
 * each from their progress report. A row opens their next 30 days and replies beside it.
 */
function StudentsPage() {
  const students = useStudents();
  const [inviting, setInviting] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  // "Synced 9 days ago" counts from when the page opened; a minute's drift doesn't matter.
  const [now] = useState(() => Date.now());
  const selected = students?.find((s) => s.id === current) ?? students?.[0] ?? null;

  return (
    <div className="grid min-w-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-visible">
      <div className="flex min-w-0 flex-col md:overflow-y-auto">
        <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2.5 px-4 py-2">
          <h1 className="font-semibold text-sm">Students</h1>
          <span className="text-muted-foreground text-xs">{students?.length ?? 0} connected</span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setInviting(true)}>
            <PlusIcon /> Invite a student
          </Button>
        </header>
        {inviting ? <Invite onClose={() => setInviting(false)} /> : null}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]" data-testid="students">
            <thead>
              <tr>
                {HEAD.map(([h, sub]) => (
                  <th
                    key={h}
                    className="border-b border-input px-3 py-1.5 text-left font-medium text-muted-foreground text-xs whitespace-nowrap"
                  >
                    {h}
                    {sub ? <span className="ml-1.5 font-normal text-2xs">{sub}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students?.map((s) => {
                const c = s.report?.counts;
                const tiers = (["reach", "match", "safety"] as const).map(
                  (t) => s.report?.shortlist.filter((x) => x.tier === t).length ?? 0,
                );
                const stale = !s.syncedAt || now - new Date(s.syncedAt).getTime() > WEEK;
                return (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    aria-selected={selected?.id === s.id}
                    onClick={() => setCurrent(s.id)}
                    onKeyDown={(e) => e.key === "Enter" && setCurrent(s.id)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-secondary",
                      selected?.id === s.id && "bg-primary/7",
                    )}
                  >
                    <Td strong>{s.name}</Td>
                    <Td>{s.report?.hunt ?? ""}</Td>
                    <Td>
                      <NextDeadline s={s} now={now} />
                    </Td>
                    <Td className="tabular-nums">{c ? `${c.schools} · ${tiers.join("/")}` : ""}</Td>
                    <Td className="tabular-nums">
                      {c ? `${c.professors} · ${c.emailed} · ${c.replied}` : ""}
                    </Td>
                    <Td muted className={stale ? "text-warning-foreground" : ""}>
                      {s.syncedAt ? since(s.syncedAt, now) : "never"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {students?.length === 0 ? (
            <div className="px-6 py-16 text-center text-muted-foreground text-xs">
              No students yet. Invite one: they paste the code in their Settings.
            </div>
          ) : null}
        </div>
      </div>
      {selected ? <StudentPanel key={selected.id} s={selected} /> : null}
    </div>
  );
}
