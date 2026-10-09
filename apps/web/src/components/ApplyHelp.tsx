import {
  type Application,
  answerFor,
  answerSheet,
  PortalField,
  PortalFilled,
  type Professor,
  type Program,
} from "@getmyprof/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const ONLY_YOU =
  "Only you: create the account, pay the fee or get the waiver, upload files, sign, and press Submit.";

/**
 * Help with this application's portal. Everywhere: the answer sheet, every field portals ask
 * filled from what the app knows, with its source and a copy button. In the desktop app: the
 * portal opens in its own window, Read this page lists its fields with a proposed answer each
 * (the sheet's, or the agent's for the rest), you edit and pick, and Fill types them in. It never
 * uploads, pays, signs or submits.
 */
export function ApplyHelp({
  app,
  program,
  people,
}: {
  app: Application;
  program: Program;
  people: Professor[];
}) {
  const state = useStore((s) => s.app);
  const vault = useStore((s) => s.vault);
  const navigate = useNavigate();
  const desktop = typeof window === "undefined" ? undefined : window.getmyprofDesktop?.portal;
  const [fields, setFields] = useState<PortalField[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  if (!state) return null;
  const sheet = answerSheet({
    app,
    program,
    applicant: state.applicant,
    facts: state.facts,
    hunt: state.hunt,
    mail: state.mail,
    records: people,
    documents: vault?.documents ?? [],
    writing: vault?.writing ?? [],
  });
  const valueOf = (f: PortalField) => {
    const a = answerFor(f, sheet, app.answers);
    return edits[f.key] ?? (a && "value" in a ? a.value : "");
  };
  const run = (job: () => Promise<void>) =>
    void job().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

  const read = () =>
    run(async () => {
      if (!desktop) return;
      setError("");
      const found = PortalField.array().parse(await desktop.read());
      setFields(found);
      setResults({});
      // Everything with an answer starts picked; what's yours or unanswered doesn't.
      setPicked(
        new Set(
          found
            .filter((f) => {
              const a = answerFor(f, sheet, app.answers);
              return a !== null && "value" in a && a.value !== f.value;
            })
            .map((f) => f.key),
        ),
      );
    });
  const fill = () =>
    run(async () => {
      if (!desktop || !fields) return;
      const values = fields
        .filter((f) => picked.has(f.key))
        .map((f) => ({ key: f.key, value: valueOf(f) }));
      const done = PortalFilled.parse(await desktop.fill(values));
      setResults(Object.fromEntries(done.map((d) => [d.key, d.ok ? "filled" : d.note])));
    });
  const ask = () =>
    run(async () => {
      if (!fields) return;
      const open = fields.filter((f) => answerFor(f, sheet, app.answers) === null);
      const t = await call("applications.suggestAnswers", { id: app.id, fields: open });
      void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
    });
  const unanswered = fields?.filter((f) => answerFor(f, sheet, app.answers) === null).length ?? 0;

  return (
    <div className="flex flex-col gap-2" data-testid="apply-help">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          defaultValue={app.portal}
          placeholder="the portal's link, e.g. https://apply.school.edu"
          aria-label="Portal link"
          onBlur={(e) =>
            e.target.value.trim() !== app.portal &&
            void call("vault.save", {
              kind: "application",
              value: { ...app, portal: e.target.value.trim() },
            })
          }
          className="h-6.5 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 outline-none placeholder:text-placeholder"
        />
        {desktop ? (
          <>
            <Button
              size="xs"
              variant="outline"
              disabled={!app.portal}
              onClick={() => run(() => desktop.open(app.portal))}
            >
              Open portal
            </Button>
            <Button size="xs" variant="outline" onClick={read}>
              Read this page
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">
            In the desktop app, getmyprof can fill the portal's pages for you.
          </span>
        )}
      </div>
      {error ? <div className="text-destructive-foreground">{error}</div> : null}

      {fields ? (
        <div data-testid="portal-fields">
          <div className="grid grid-cols-[18px_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_80px] items-center gap-x-2 gap-y-1">
            {fields.map((f) => {
              const a = answerFor(f, sheet, app.answers);
              const yours = a && "yours" in a ? a.yours : null;
              return (
                <div key={f.key} className="contents" data-testid="portal-field">
                  <input
                    type="checkbox"
                    aria-label={`Fill ${f.label}`}
                    className="size-3.5 accent-foreground"
                    disabled={!!yours}
                    checked={picked.has(f.key)}
                    onChange={() =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (next.has(f.key)) next.delete(f.key);
                        else next.add(f.key);
                        return next;
                      })
                    }
                  />
                  <span className="truncate text-secondary-label" title={f.label}>
                    {f.label}
                    {f.required ? " *" : ""}
                  </span>
                  {yours ? (
                    <span className="text-muted-foreground">{yours}</span>
                  ) : (
                    <input
                      value={valueOf(f)}
                      aria-label={`Answer for ${f.label}`}
                      onChange={(e) => {
                        setEdits((x) => ({ ...x, [f.key]: e.target.value }));
                        setPicked((p) => new Set(p).add(f.key));
                      }}
                      placeholder={
                        f.options.length ? f.options.slice(0, 4).join(" · ") : "no answer yet"
                      }
                      className="h-6 min-w-0 rounded-md border border-input bg-transparent px-2 outline-none placeholder:text-placeholder"
                    />
                  )}
                  <span
                    className="truncate text-muted-foreground"
                    title={a && "source" in a ? a.source : ""}
                  >
                    {a && "source" in a ? a.source : ""}
                  </span>
                  <span
                    className={cn(
                      results[f.key] === "filled"
                        ? "text-success-foreground"
                        : "text-warning-foreground",
                    )}
                  >
                    {results[f.key] ?? ""}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button size="xs" disabled={!picked.size} onClick={fill}>
              Fill {picked.size} field{picked.size === 1 ? "" : "s"}
            </Button>
            {unanswered ? (
              <Button size="xs" variant="outline" onClick={ask}>
                Ask the agent for the other {unanswered}
              </Button>
            ) : null}
            <span className="text-muted-foreground">{ONLY_YOU}</span>
          </div>
        </div>
      ) : (
        <div data-testid="answer-sheet">
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.8fr)_24px] items-center gap-x-2 gap-y-0.5">
            {sheet.map((a) => (
              <div key={a.label} className="contents">
                <span className="text-muted-foreground">{a.label}</span>
                <span className="truncate text-secondary-label" title={a.value}>
                  {a.value}
                </span>
                <span className="truncate text-muted-foreground" title={a.source}>
                  {a.source}
                </span>
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={`Copy ${a.label}`}
                  onClick={() => void navigator.clipboard.writeText(a.value)}
                >
                  <CopyIcon />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-muted-foreground">{ONLY_YOU}</div>
        </div>
      )}
    </div>
  );
}
