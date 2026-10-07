import type { Writing } from "@gradcode/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { checks, citations, layout, plainText, strayMarkers } from "~/lib/writing";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

// /vault/writing/<id>, outside the Vault's own layout, so the sidebar's Vault stays lit.
export const Route = createFileRoute("/_shell/vault_/writing/$id")({ component: WriterPage });

const KIND_LABEL = { sop: "Statement of purpose", cv: "CV", essay: "Scholarship essay" } as const;

/** "2026-12-01" as "Dec 1, 2026", read as a calendar date. */
const longDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Label({ children }: { children: string }) {
  return <div className="mt-4 mb-1 text-muted-foreground first:mt-0">{children}</div>;
}

/** The text with numbered citations; a sentence resting on an unproven fact is highlighted. */
function Body({ w, blocked }: { w: Writing; blocked: Set<string> }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-7" data-testid="writing-body">
      {layout(w, blocked).map((p) => (
        <p key={p.key}>
          {p.sentences.map((s) => (
            <span
              key={s.key}
              data-blocked={s.blocked || undefined}
              className={cn(s.blocked && "rounded bg-warning/10 px-0.5 text-warning-foreground")}
            >
              {s.parts.map((part) =>
                "cite" in part ? (
                  <sup
                    key={part.key}
                    className={cn(
                      "ml-px font-mono text-3xs",
                      blocked.has(part.cite) ? "text-warning-foreground" : "text-info-foreground",
                    )}
                  >
                    {part.cite}
                  </sup>
                ) : (
                  part.text
                ),
              )}{" "}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/** Edit the raw text. [n] markers keep their facts; new ones with no fact are flagged. */
function Editor({ w, done }: { w: Writing; done: () => void }) {
  const [text, setText] = useState(w.body);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Text"
        rows={18}
        className="w-full resize-y rounded-xl border bg-transparent p-3 text-sm leading-6 outline-none focus:border-ring/40"
      />
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost-muted" onClick={done}>
          Cancel
        </Button>
        <Button
          size="xs"
          onClick={async () => {
            await call("vault.save", { kind: "writing", value: { ...w, body: text } });
            done();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function WriterPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const vault = useStore((s) => s.vault);
  const app = useStore((s) => s.app);
  const recordsVersion = useStore((s) => s.recordsVersion);
  const [editing, setEditing] = useState(false);
  const [tailorTo, setTailorTo] = useState("");
  const [copied, setCopied] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void call("records.list", {}).then((r) =>
      setNames(Object.fromEntries(r.map((p) => [p.key, p.name]))),
    );
  }, [recordsVersion]);

  const w = vault?.writing.find((x) => x.id === id);
  if (!vault || !app) return <div className="flex-1" />;
  if (!w)
    return (
      <div className="m-auto text-muted-foreground text-xs">
        This piece is gone.{" "}
        <Link to="/vault" search={{ section: "writing" }} className="underline">
          Back to Writing
        </Link>
      </div>
    );

  const program = vault.programs.find((p) => p.id === w.programId);
  const scholarship = vault.scholarships.find((s) => s.id === w.scholarshipId);
  const named = (vault.applications.find((a) => a.programId === w.programId)?.professors ?? []).map(
    (k) => names[k] ?? k,
  );
  const cited = citations(w, app.facts);
  const stray = strayMarkers(w);
  const blocked = new Set([...cited.filter((c) => !c.ok).map((c) => c.n), ...stray]);
  const c = checks(w, { named, applicant: app.applicant });
  const exportable = blocked.size === 0 && !c.scoreClaimed;
  const others = vault.programs.filter((p) => p.id !== w.programId);

  const start = async (programId: string | null, basedOn: string) => {
    const t = await call("writing.start", {
      kind: w.kind,
      programId,
      scholarshipId: programId === w.programId ? w.scholarshipId : null,
      basedOn,
    });
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  };

  return (
    <div className="grid min-w-0 flex-1 grid-cols-[240px_minmax(0,1fr)_300px]">
      <aside className="min-h-0 overflow-y-auto border-r px-4 py-4 text-xs">
        <Link
          to="/vault"
          search={{ section: "writing" }}
          className="mb-3 block text-muted-foreground hover:text-foreground"
        >
          Writing
        </Link>
        <Label>For</Label>
        <div className="font-medium text-foreground text-sm">
          {program
            ? `${program.university} · ${program.name}`
            : (scholarship?.name ?? "Any program")}
        </div>
        <div className="text-muted-foreground">
          {KIND_LABEL[w.kind]}
          {program?.deadline ? ` · due ${longDate(program.deadline)}` : ""}
          {scholarship?.deadline ? ` · due ${longDate(scholarship.deadline)}` : ""}
        </div>
        {named.length ? (
          <>
            <Label>Name these professors</Label>
            <div className="text-secondary-label">{named.join(", ")}</div>
          </>
        ) : null}
        <Label>Your other documents here</Label>
        <div className="text-secondary-label">
          {vault.documents.map((d) => d.name).join(" · ") || "none yet"}
        </div>
        <div className="mt-5 flex flex-col items-start gap-1.5">
          <Button size="xs" variant="outline" onClick={() => void start(w.programId, w.id)}>
            Ask for draft {w.draft + 1}
          </Button>
          {w.kind === "sop" && others.length ? (
            <div className="flex items-center gap-1">
              <select
                aria-label="Tailor to"
                value={tailorTo || others[0]?.id}
                onChange={(e) => setTailorTo(e.target.value)}
                className="h-6.5 max-w-36 rounded-md border border-input bg-background px-1.5 text-foreground text-xs outline-none"
              >
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.university}
                  </option>
                ))}
              </select>
              <Button
                size="xs"
                variant="ghost-muted"
                onClick={() => void start(tailorTo || others[0]?.id || null, w.id)}
              >
                Tailor
              </Button>
            </div>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            disabled={!exportable}
            onClick={async () => {
              await navigator.clipboard.writeText(plainText(w));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy text"}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!exportable}
            onClick={() => window.open(`/print/${w.id}`, "_blank", "noopener")}
          >
            Export PDF
          </Button>
          {exportable ? null : (
            <span className="text-warning-foreground">
              Export waits until every claim has proof.
            </span>
          )}
        </div>
        {w.history.length ? (
          <>
            <Label>Earlier drafts</Label>
            <ul className="flex flex-col gap-1" data-testid="history">
              {w.history.toReversed().map((h) => (
                <li key={h.draft} className="flex items-center gap-2 text-secondary-label">
                  Draft {h.draft}
                  <span className="text-muted-foreground">{h.at.slice(0, 10)}</span>
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    className="ml-auto"
                    onClick={() =>
                      void call("vault.save", {
                        kind: "writing",
                        value: {
                          ...w,
                          draft: w.draft + 1,
                          body: h.body,
                          citations: h.citations,
                          history: [
                            ...w.history,
                            {
                              draft: w.draft,
                              body: w.body,
                              citations: w.citations,
                              at: w.updatedAt,
                            },
                          ].slice(-10),
                        },
                      })
                    }
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </aside>
      <div className="min-h-0 overflow-y-auto px-10 py-6">
        <div className="mx-auto max-w-[44rem]">
          <div className="mb-4 flex items-baseline gap-3">
            <h1 className="font-semibold text-lg tracking-tight">
              {KIND_LABEL[w.kind]}, draft {w.draft}
            </h1>
            {editing ? null : (
              <Button size="xs" variant="ghost-muted" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
          {editing ? (
            <Editor w={w} done={() => setEditing(false)} />
          ) : (
            <Body w={w} blocked={blocked} />
          )}
        </div>
      </div>
      <aside className="min-h-0 overflow-y-auto border-l px-4 py-4 text-xs">
        <Label>Facts used</Label>
        <ol className="flex flex-col" data-testid="facts-used">
          {cited.map((x) => (
            <li key={x.n} className="flex gap-3 border-b py-1.5">
              <span
                className={cn(
                  "w-4 font-mono",
                  x.ok ? "text-info-foreground" : "text-warning-foreground",
                )}
              >
                {x.n}
              </span>
              <span className={x.ok ? "text-secondary-label" : "text-warning-foreground"}>
                {x.fact?.text ?? "a fact that's no longer in the vault"}
              </span>
            </li>
          ))}
        </ol>
        {blocked.size || stray.length ? (
          <>
            <Label>Blocked</Label>
            <ul className="flex flex-col gap-1.5 text-warning-foreground" data-testid="blocked">
              {cited
                .filter((x) => !x.ok)
                .map((x) => (
                  <li key={x.n}>
                    "{x.fact?.text ?? `[${x.n}]`}" has no proof in the vault. Add proof, or cut the
                    line.
                  </li>
                ))}
              {stray.map((n) => (
                <li key={`stray-${n}`}>[{n}] points at no fact. Cite one, or remove it.</li>
              ))}
            </ul>
          </>
        ) : null}
        <Label>Checks</Label>
        <p className="text-secondary-label" data-testid="checks">
          {c.pages} page{c.pages === 1 ? "" : "s"} · {c.words} words
          {c.namedTotal
            ? ` · names ${c.namedFound} of ${c.namedTotal} professor${c.namedTotal === 1 ? "" : "s"}`
            : ""}
          {" · "}
          <span className={c.scoreClaimed ? "text-warning-foreground" : undefined}>
            {c.scoreClaimed ? "claims a test score no fact backs" : "no test score claimed"}
          </span>
          {" · "}
          <span className={c.emDashes ? "text-warning-foreground" : undefined}>
            {c.emDashes ? `${c.emDashes} em dashes` : "no em dashes"}
          </span>
        </p>
        {blocked.size ? (
          <Link
            to="/vault"
            search={{ section: "facts" }}
            className="mt-4 block text-info-foreground hover:underline"
          >
            Add proof in Facts
          </Link>
        ) : null}
      </aside>
    </div>
  );
}
