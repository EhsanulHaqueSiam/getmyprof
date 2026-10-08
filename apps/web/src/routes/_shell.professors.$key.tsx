import type { MethodOutput } from "@getmyprof/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BookOpenIcon, FileTextIcon, GlobeIcon, LinkIcon, MessageSquareIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { TIER_LABEL } from "~/lib/columns";
import { ago } from "~/lib/format";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/professors/$key")({ component: ProfessorPage });

const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? url;
const day = (iso: string) => iso.slice(5, 10);
const AWARD_PAGE: Record<string, (id: string) => string> = {
  NSF: (id) => `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${id}`,
  NIH: (id) => `https://reporter.nih.gov/project-details/${id}`,
};

/** Where a field's value came from: the latest accepted change's first source, and its date. */
function Source({ of }: { of: { sources: string[]; at: string } | undefined }) {
  const url = of?.sources.find((s) => /^https?:\/\//.test(s));
  if (!of) return null;
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-muted-foreground text-xs hover:text-secondary-label hover:underline"
    >
      {host(url)} · {day(of.at)}
    </a>
  ) : (
    <span className="shrink-0 text-muted-foreground text-xs">{day(of.at)}</span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-1.5 font-medium text-muted-foreground text-xs">{title}</h2>
      {children}
    </section>
  );
}

/** One line of a section: the value, and where it came from on the right. */
function Line({ children, source }: { children: ReactNode; source?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b py-1.5 text-[13px] text-secondary-label">
      <span className="min-w-0 flex-1">{children}</span>
      {source}
    </div>
  );
}

/**
 * A professor: every fact with the page it came from and when, what they look for in students,
 * their grants, recent work and interests (live from NSF, NIH and OpenAlex), and beside it what
 * happened, their threads, the program at their school and where the email to them stands.
 */
function ProfessorPage() {
  const { key } = Route.useParams();
  const navigate = useNavigate();
  const recordsVersion = useStore((s) => s.recordsVersion);
  const [data, setData] = useState<MethodOutput<"records.get"> | null>(null);
  const [live, setLive] = useState<MethodOutput<"records.scholarly"> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    call("records.get", { key }).then(setData, (e: Error) => setError(e.message));
  }, [key, recordsVersion]);
  useEffect(() => {
    setLive(null);
    call("records.scholarly", { key }).then(setLive, () =>
      setLive({ grants: [], works: [], interests: [] }),
    );
  }, [key]);

  if (error) return <div className="flex-1 p-8 text-muted-foreground text-sm">{error}</div>;
  if (!data) return <div className="flex-1" />;
  const p = data.record;
  // A field set by an accepted change shows that change's sources; one that came in another way
  // (Add PI, a CSV, gradhunt) shows the record's own.
  const own = p.sources.length ? { sources: p.sources, at: p.updatedAt } : undefined;
  const sourceOf = (
    field:
      | "money"
      | "moneyTier"
      | "taking"
      | "seeking"
      | "contact"
      | "emailCheck"
      | "niche"
      | "recent"
      | "fitsBecause",
  ) => data.fieldSources[field] ?? (p[field] ? own : undefined);
  const last = p.name.split(" ").at(-1) ?? p.name;
  // The record's grants first, then any the free APIs know that it doesn't.
  const grants = [
    ...p.grants.map((g) => ({ ...g, url: AWARD_PAGE[g.source]?.(g.id) ?? "" })),
    ...(live?.grants ?? [])
      .filter((a) => !p.grants.some((g) => g.id === a.id))
      .map((a) => ({
        source: a.source,
        id: a.id,
        title: a.title,
        usd: a.amount,
        ends: a.ends,
        url: a.url,
      })),
  ];
  const interests = [p.niche, ...(live?.interests ?? [])].filter(Boolean);
  // OpenAlex lists newest first: when they last published.
  const lastPaper = live?.works[0]?.date.slice(0, 7);
  const draft = data.draft;

  return (
    <div className="grid min-w-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-visible">
      <section className="overflow-y-auto px-8 py-6">
        <div className="text-muted-foreground text-xs">
          <Link to="/professors" className="hover:text-secondary-label">
            Professors
          </Link>{" "}
          / {p.university}
        </div>
        <h1 className="mt-1.5 font-semibold text-xl tracking-tight">{p.name}</h1>
        <p className="mt-0.5 text-muted-foreground text-sm">
          {[p.department, p.university].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-muted-foreground text-xs">
          <span>
            fit <b className="text-foreground">{p.fit || "?"}</b>
          </span>
          <span className="flex items-baseline gap-1.5">
            tier <b className="text-foreground">{TIER_LABEL[p.moneyTier]}</b>
            {/* The page that shows the money behind the tier. */}
            {p.moneyTier ? <Source of={sourceOf("moneyTier")} /> : null}
          </span>
          <span>
            email <b className="text-foreground">{p.emailCheck || "unchecked"}</b>
            {data.fieldSources.emailCheck ? ` ${data.fieldSources.emailCheck.at.slice(0, 10)}` : ""}
          </span>
          <span>
            stage <b className="text-foreground">{p.stage}</b>
          </span>
          {data.school ? (
            <Link to="/schools" className="hover:text-secondary-label">
              school <b className="text-foreground">{data.school.tier}</b>
            </Link>
          ) : null}
          {lastPaper ? (
            <span>
              last paper <b className="text-foreground">{lastPaper}</b>
            </span>
          ) : null}
          {p.origin === "gradhunt" ? <span>from gradhunt</span> : null}
        </div>
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          <Button
            size="xs"
            onClick={() => void navigate({ to: "/", search: { about: p.key, name: p.name } })}
          >
            <MessageSquareIcon /> Ask about {last}
          </Button>
          {draft && draft.status !== "sent" ? (
            <Button variant="outline" size="xs" render={<Link to="/pipeline" />}>
              <FileTextIcon /> Open draft
            </Button>
          ) : null}
          {p.website ? (
            <Button
              variant="ghost-muted"
              size="xs"
              render={<a href={p.website} target="_blank" rel="noreferrer" />}
            >
              <GlobeIcon /> Website
            </Button>
          ) : null}
          {p.linkedin ? (
            <Button
              variant="ghost-muted"
              size="xs"
              render={<a href={p.linkedin} target="_blank" rel="noreferrer" />}
            >
              <LinkIcon /> LinkedIn
            </Button>
          ) : null}
          <Button
            variant="ghost-muted"
            size="xs"
            render={
              <a
                href={
                  p.scholar ||
                  `https://scholar.google.com/scholar?q=${encodeURIComponent(`author:"${p.name}" ${p.university}`)}`
                }
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <BookOpenIcon /> Scholar
          </Button>
        </div>

        <Section title="Money">
          <Line source={<Source of={sourceOf("money")} />}>
            {p.money || <span className="text-placeholder">not found</span>}
            {p.lasts ? <span className="text-muted-foreground"> · lasts {p.lasts}</span> : null}
          </Line>
          {grants.map((g) => (
            <Line
              key={`${g.source}${g.id}`}
              source={
                g.url ? (
                  <a
                    href={g.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-muted-foreground text-xs hover:underline"
                  >
                    {g.source} {g.id}
                  </a>
                ) : (
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {g.source} {g.id}
                  </span>
                )
              }
            >
              {g.title}
              <span className="text-muted-foreground">
                {g.usd ? ` · $${Math.round(g.usd).toLocaleString("en-US")}` : ""}
                {g.ends ? ` · ends ${g.ends.slice(0, 7)}` : ""}
              </span>
            </Line>
          ))}
          {live === null ? (
            <Line>
              <span className="text-muted-foreground">Looking up NSF and NIH</span>
            </Line>
          ) : null}
        </Section>

        <Section title="Taking students">
          <Line source={<Source of={sourceOf("taking")} />}>
            {p.taking || <span className="text-placeholder">not found</span>}
          </Line>
        </Section>

        <Section title="Looking for">
          <Line source={<Source of={sourceOf("seeking")} />}>
            {p.seeking || <span className="text-placeholder">not found</span>}
          </Line>
        </Section>

        <Section title="How to reach">
          <Line source={<Source of={sourceOf("contact")} />}>
            {p.contact ? (
              <blockquote className="border-l-2 pl-3">{p.contact}</blockquote>
            ) : (
              <span className="text-placeholder">not found</span>
            )}
          </Line>
          <Line source={<Source of={data.fieldSources.email ?? sourceOf("emailCheck")} />}>
            {p.email || <span className="text-placeholder">no address yet</span>}
            {p.emailCheck ? <span className="text-muted-foreground"> · {p.emailCheck}</span> : null}
          </Line>
        </Section>

        <Section title="Recent work">
          {p.recent ? <Line source={<Source of={sourceOf("recent")} />}>{p.recent}</Line> : null}
          {live === null ? (
            <Line>
              <span className="text-muted-foreground">Looking up OpenAlex</span>
            </Line>
          ) : live.works.length ? (
            live.works.map((w) => (
              <Line
                key={w.link || w.title}
                source={
                  w.link ? (
                    <a
                      href={w.link}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-muted-foreground text-xs hover:underline"
                    >
                      {w.date.slice(0, 7)} · {host(w.link)}
                    </a>
                  ) : (
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {w.date.slice(0, 7)}
                    </span>
                  )
                }
              >
                {w.title}
              </Line>
            ))
          ) : p.recent ? null : (
            <Line>
              <span className="text-placeholder">none found on OpenAlex</span>
            </Line>
          )}
        </Section>

        <Section title="Interests">
          <Line source={<Source of={sourceOf("niche")} />}>
            {interests.length ? (
              interests.join(" · ")
            ) : (
              <span className="text-placeholder">not found</span>
            )}
          </Line>
        </Section>

        {p.fitsBecause ? (
          <Section title="Fits because">
            <Line source={<Source of={sourceOf("fitsBecause")} />}>{p.fitsBecause}</Line>
          </Section>
        ) : null}

        <Section title="Sources">
          {p.sources.length ? (
            p.sources.map((s) => (
              <a
                key={s}
                href={s}
                target="_blank"
                rel="noreferrer"
                className="block truncate py-1 text-secondary-label text-xs hover:text-foreground hover:underline"
              >
                {s}
              </a>
            ))
          ) : (
            <p className="text-muted-foreground text-xs">No sources recorded.</p>
          )}
        </Section>
      </section>

      <aside className="overflow-y-auto border-l p-4 text-xs" data-testid="professor-side">
        <h2 className="mb-1.5 text-muted-foreground">Timeline</h2>
        {data.timeline.length ? (
          data.timeline.map((t) => (
            <div key={`${t.at}${t.text}`} className="flex gap-2.5 py-1 text-secondary-label">
              <span className="w-10 shrink-0 font-mono text-muted-foreground">{day(t.at)}</span>
              <span>{t.text}</span>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">Nothing yet.</p>
        )}

        <h2 className="mt-4 mb-1.5 text-muted-foreground">Threads</h2>
        {data.threads.map((t) => (
          <Link
            key={t.id}
            to="/t/$threadId"
            params={{ threadId: t.id }}
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-secondary-label transition-colors hover:bg-accent"
          >
            <span className="truncate">{t.title}</span>
            <span className="ml-auto text-muted-foreground">
              {t.settledAt ? "settled" : ago(t.updatedAt)}
            </span>
          </Link>
        ))}

        <h2 className="mt-4 mb-1.5 text-muted-foreground">Program</h2>
        {data.programs.length ? (
          data.programs.map((pr) => (
            <div key={pr.name} className="py-1 text-secondary-label">
              {pr.name} · {pr.deadline ? `deadline ${pr.deadline}` : "deadline not found yet"}
              {pr.funding ? <span className="text-muted-foreground"> · {pr.funding}</span> : null}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">No program at {p.university} in the Vault yet.</p>
        )}

        <h2 className="mt-4 mb-1.5 text-muted-foreground">Email</h2>
        {draft ? (
          <Link to="/pipeline" className="block text-secondary-label hover:underline">
            {draft.status} {draft.touch} · {draft.subject || "no subject"} · {day(draft.at)}
          </Link>
        ) : (
          <p className="text-muted-foreground">Not written yet.</p>
        )}
      </aside>
    </div>
  );
}
