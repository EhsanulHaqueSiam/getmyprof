import type { MethodOutput } from "@gradcode/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { GlobeIcon, MessageSquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { ago } from "~/lib/format";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/professors/$key")({ component: ProfessorPage });

function ProfessorPage() {
  const { key } = Route.useParams();
  const navigate = useNavigate();
  const recordsVersion = useStore((s) => s.recordsVersion);
  const [data, setData] = useState<MethodOutput<"records.get"> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    call("records.get", { key }).then(setData, (e: Error) => setError(e.message));
  }, [key, recordsVersion]);

  if (error) return <div className="flex-1 p-8 text-muted-foreground text-sm">{error}</div>;
  if (!data) return <div className="flex-1" />;
  const p = data.record;
  const ask = async () => {
    const t = await call("threads.create", {
      text: `Vet ${p.name} at ${p.university}: are they taking students for my intake, is their money active and how long does it last, and how do they want to be contacted?`,
      title: `Vet ${p.name}`,
    });
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  };
  const facts: [string, string][] = [
    ["Niche", p.niche],
    ["Money", p.money],
    ["Lasts", p.lasts],
    ["Taking students", p.taking],
    ["How to reach", p.contact],
    ["Email", [p.email, p.emailCheck].filter(Boolean).join(" · ")],
    ["Fits because", p.fitsBecause],
  ];

  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-y-auto px-8 py-6">
        <Link to="/professors" className="text-muted-foreground text-xs hover:text-secondary-label">
          Professors
        </Link>
        <h1 className="mt-1.5 font-semibold text-xl tracking-tight">{p.name}</h1>
        <p className="mt-0.5 text-muted-foreground text-sm">
          {[p.department, p.university].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-muted-foreground text-xs">
          <span>
            fit <b className="text-foreground">{p.fit}</b>
          </span>
          <span>
            stage <b className="text-foreground">{p.stage}</b>
          </span>
          {p.origin === "gradhunt" ? <span>from gradhunt</span> : null}
        </div>
        <div className="mt-3.5 flex gap-1.5">
          <Button size="xs" onClick={() => void ask()}>
            <MessageSquareIcon /> Ask about {p.name.split(" ").at(-1)}
          </Button>
          {p.website ? (
            <Button
              variant="ghost-muted"
              size="xs"
              render={<a href={p.website} target="_blank" rel="noreferrer" />}
            >
              <GlobeIcon /> Website
            </Button>
          ) : null}
        </div>
        <dl className="mt-6 grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 text-[13px]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="border-b py-2 text-muted-foreground text-xs">{k}</dt>
              <dd className="border-b py-2 text-secondary-label">
                {v || <span className="text-placeholder">not found</span>}
              </dd>
            </div>
          ))}
        </dl>
        <h2 className="mt-6 mb-1.5 font-medium text-muted-foreground text-xs">Sources</h2>
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
      </section>
      <aside className="overflow-y-auto border-l p-4 text-xs">
        <h2 className="mb-1.5 text-muted-foreground">Threads</h2>
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
        <h2 className="mt-4 mb-1.5 text-muted-foreground">Changes</h2>
        {data.proposals.map((pr) => (
          <div key={pr.id} className="border-b py-1.5 text-secondary-label">
            <span className="text-muted-foreground">{pr.status}</span> ·{" "}
            {pr.changes.map((c) => c.field).join(", ")}
          </div>
        ))}
      </aside>
    </div>
  );
}
