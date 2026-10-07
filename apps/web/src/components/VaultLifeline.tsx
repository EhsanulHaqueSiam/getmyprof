import { factStatus, type ProfileFact, type VaultDocument } from "@gradcode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Chip } from "~/components/FormParts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { guessKind, toBase64 } from "~/lib/files";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/** One dated line: a fact, or a document you handed over. */
type Item =
  | { id: string; date: string; kind: "fact"; fact: ProfileFact }
  | { id: string; date: string; kind: "doc"; doc: VaultDocument };

const KIND_LABEL = {
  education: "Education",
  paper: "Papers",
  work: "Roles",
  project: "Projects",
  test: "Tests",
  other: "Other",
} as const satisfies Record<ProfileFact["kind"], string>;
const FACT_KINDS = ["education", "paper", "work", "project", "test", "other"] as const;
const FILTERS = ["all", ...FACT_KINDS, "documents"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_TONE = {
  confirmed: "text-success-foreground",
  unconfirmed: "text-muted-foreground",
  "needs proof": "text-warning-foreground",
  question: "text-status-input",
} as const satisfies Record<ReturnType<typeof factStatus>, string>;

const URLS = /https?:\/\/\S+/g;

/**
 * The Vault's front page: one box to add anything (a file, a link, a sentence) and your life as a
 * dated line. The panel beside it shows the picked item's note, your facts as a CV, or the file.
 */
export function VaultLifeline() {
  const app = useStore((s) => s.app);
  const vault = useStore((s) => s.vault);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<"note" | "cv" | "preview">("note");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!app || !vault) return null;
  const fromHq = app.settings.profileSource === "hq";

  const items: Item[] = [
    ...app.facts.map((f) => ({ id: f.id, date: f.date, kind: "fact" as const, fact: f })),
    ...vault.documents.map((d) => ({
      id: d.id,
      date: d.uploadedAt.slice(0, 10),
      kind: "doc" as const,
      doc: d,
    })),
  ]
    .filter((i) =>
      filter === "all"
        ? true
        : filter === "documents"
          ? i.kind === "doc"
          : i.kind === "fact" && i.fact.kind === filter,
    )
    .toSorted((a, b) => (b.date || "0").localeCompare(a.date || "0"));
  const years = [...new Set(items.map((i) => i.date.slice(0, 4) || "Undated"))];
  const selected = items.find((i) => i.id === picked) ?? null;

  // A fact's proof, when it's a file in the vault.
  const proofOf = (f: ProfileFact) =>
    vault.documents.find((d) => d.id === f.source || d.name === f.source) ?? null;
  const usedIn = (id: string) =>
    vault.writing.filter((w) => Object.values(w.citations).includes(id)).length;

  /** Reads a sentence or links into draft facts, merged in unconfirmed for you to check. */
  const addFacts = async (input: { text: string; links: string[]; pdfBase64?: string }) => {
    const drafted = await call("facts.extract", input);
    const known = new Set(app.facts.map((f) => f.text.toLowerCase()));
    const fresh = drafted.filter((f) => !known.has(f.text.toLowerCase()));
    if (fresh.length) await call("facts.save", { facts: [...app.facts, ...fresh] });
    return fresh.length;
  };

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-h-0 overflow-y-auto px-5 py-4">
        {fromHq ? (
          <p className="mb-3 text-muted-foreground text-xs">
            Your facts live in hq, which this install reads. Add to them there: hq tell "..."
          </p>
        ) : (
          <form
            className="mb-3 flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const links = text.match(URLS) ?? [];
              void run(async () => {
                await addFacts({ text: text.replace(URLS, " ").trim(), links });
                setText("");
              });
            }}
          >
            <div className="flex gap-2">
              <Input
                size="compact"
                aria-label="Add to your lifeline"
                placeholder='Add anything: paste a link (Scholar, ORCID, GitHub) or type "IELTS booked for 20 Oct"'
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button size="xs" type="submit" disabled={busy || !text.trim()}>
                {busy ? "Reading" : "Add"}
              </Button>
              <label className="flex h-7 shrink-0 cursor-pointer items-center rounded-md border px-2 text-xs hover:bg-accent">
                File
                <input
                  type="file"
                  className="hidden"
                  aria-label="Add a file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void run(async () => {
                      const base64 = await toBase64(file);
                      const kind = guessKind(file.name, "other");
                      await call("documents.upload", {
                        name: file.name,
                        kind,
                        mime: file.type,
                        base64,
                        expires: null,
                      });
                      // A CV is read into facts too; any other file just joins your documents.
                      if (kind === "cv" && file.type === "application/pdf")
                        await addFacts({ text: "", links: [], pdfBase64: base64 });
                    });
                  }}
                />
              </label>
            </div>
            {error ? <span className="text-destructive-foreground text-xs">{error}</span> : null}
          </form>
        )}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "documents" ? "Documents" : KIND_LABEL[f]}
            </Chip>
          ))}
        </div>
        {years.map((year) => (
          <section key={year} data-testid="lifeline-year">
            <div className="mt-3 mb-1 text-muted-foreground text-xs">{year}</div>
            {items
              .filter((i) => (i.date.slice(0, 4) || "Undated") === year)
              .map((i) => (
                <button
                  key={i.id}
                  type="button"
                  data-testid="lifeline-item"
                  onClick={() => {
                    setPicked(i.id);
                    setTab(i.kind === "doc" ? "preview" : "note");
                  }}
                  className={cn(
                    "grid w-full grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    picked === i.id && "bg-secondary",
                  )}
                >
                  <span className="font-mono text-2xs text-muted-foreground">
                    {i.date.slice(5) || ""}
                  </span>
                  <span className="truncate">{i.kind === "fact" ? i.fact.text : i.doc.name}</span>
                  <span
                    className={cn(
                      "text-2xs",
                      i.kind === "fact" ? STATUS_TONE[factStatus(i.fact)] : "text-muted-foreground",
                    )}
                  >
                    {i.kind === "fact" ? factStatus(i.fact) : i.doc.kind}
                  </span>
                </button>
              ))}
          </section>
        ))}
        {items.length === 0 ? (
          <p className="mt-6 text-muted-foreground text-xs">
            Nothing here yet. Add a CV or a link.
          </p>
        ) : null}
      </div>

      <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto border-l px-4 py-3 text-xs">
        <div className="flex gap-1.5">
          {(["note", "cv", "preview"] as const).map((t) => (
            <Chip key={t} on={tab === t} onClick={() => setTab(t)}>
              {t === "note" ? "Note" : t === "cv" ? "CV" : "Preview"}
            </Chip>
          ))}
        </div>
        {tab === "note" ? (
          selected?.kind === "fact" ? (
            <FactNote
              fact={selected.fact}
              proof={proofOf(selected.fact)}
              usedIn={usedIn(selected.fact.id)}
              readOnly={fromHq}
              onPreview={() => setTab("preview")}
            />
          ) : selected?.kind === "doc" ? (
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">File</dt>
              <dd>{selected.doc.name}</dd>
              <dt className="text-muted-foreground">Kind</dt>
              <dd>{selected.doc.kind}</dd>
              <dt className="text-muted-foreground">Added</dt>
              <dd>{selected.doc.uploadedAt.slice(0, 10)}</dd>
              <dt className="text-muted-foreground">Expires</dt>
              <dd>{selected.doc.expires ?? "never"}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground">Pick a line to see its note.</p>
          )
        ) : tab === "cv" ? (
          <CvView facts={app.facts} />
        ) : (
          <Preview
            doc={
              selected?.kind === "doc"
                ? selected.doc
                : selected?.kind === "fact"
                  ? proofOf(selected.fact)
                  : null
            }
          />
        )}
      </aside>
    </div>
  );
}

/** A fact's note: what it says, when, its proof, whether it's confirmed, and where it's used. */
function FactNote(props: {
  fact: ProfileFact;
  proof: VaultDocument | null;
  usedIn: number;
  readOnly: boolean;
  onPreview: () => void;
}) {
  const { fact, proof } = props;
  const facts = useStore((s) => s.app?.facts) ?? [];
  const status = factStatus(fact);
  return (
    <div className="flex flex-col gap-2" data-testid="fact-note">
      <div className="font-medium text-foreground text-sm">{fact.text}</div>
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{KIND_LABEL[fact.kind]}</dd>
        <dt className="text-muted-foreground">When</dt>
        <dd>{fact.date || "undated"}</dd>
        <dt className="text-muted-foreground">Proof</dt>
        <dd className="break-words">
          {proof ? (
            <button
              type="button"
              className="text-info-foreground hover:underline"
              onClick={props.onPreview}
            >
              {proof.name}
            </button>
          ) : /^https?:\/\//.test(fact.source) ? (
            <a
              href={fact.source}
              target="_blank"
              rel="noreferrer"
              className="text-info-foreground hover:underline"
            >
              {fact.source}
            </a>
          ) : (
            fact.source || "none yet"
          )}
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className={STATUS_TONE[status]}>{status}</dd>
        <dt className="text-muted-foreground">Used in</dt>
        <dd>
          {props.usedIn ? `${props.usedIn} piece${props.usedIn === 1 ? "" : "s"}` : "nothing yet"}
        </dd>
      </dl>
      {props.readOnly ? null : (
        <div>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void call("facts.save", {
                facts: facts.map((f) =>
                  f.id === fact.id ? { ...f, confirmed: !f.confirmed, question: false } : f,
                ),
              })
            }
          >
            {fact.confirmed ? "Unconfirm" : "Confirm"}
          </Button>
        </div>
      )}
    </div>
  );
}

const CV_HEADING = {
  education: "Education",
  paper: "Publications",
  work: "Experience",
  project: "Projects",
  test: "Tests",
  other: "Other",
} as const satisfies Record<ProfileFact["kind"], string>;

/** Your facts laid out like a CV, each with its status, and a button to write one from them. */
function CvView({ facts }: { facts: ProfileFact[] }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-2" data-testid="cv-view">
      {FACT_KINDS.map((kind) => {
        const here = facts.filter((f) => f.kind === kind);
        if (here.length === 0) return null;
        return (
          <section key={kind}>
            <div className="mb-0.5 text-muted-foreground">{CV_HEADING[kind]}</div>
            {here.map((f) => (
              <div key={f.id} className="flex gap-2 py-0.5">
                <span className="flex-1">{f.text}</span>
                <span className={STATUS_TONE[factStatus(f)]}>{factStatus(f)}</span>
              </div>
            ))}
          </section>
        );
      })}
      <div>
        <Button
          size="xs"
          onClick={async () => {
            const t = await call("writing.start", {
              kind: "cv",
              programId: null,
              scholarshipId: null,
              basedOn: null,
            });
            void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
          }}
        >
          Write a CV from these
        </Button>
        <p className="mt-1 text-muted-foreground">Only confirmed facts with proof go in.</p>
      </div>
    </div>
  );
}

/** The file itself: PDFs page by page, images as they are, anything else by download. */
function Preview({ doc }: { doc: VaultDocument | null }) {
  if (!doc)
    return <p className="text-muted-foreground">Pick a document, or a fact proved by one.</p>;
  const url = `/api/files/${doc.id}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="preview">
      <div className="text-muted-foreground">{doc.name}</div>
      {doc.mime === "application/pdf" ? (
        <object
          data={url}
          type="application/pdf"
          aria-label={doc.name}
          className="min-h-96 w-full flex-1 rounded-md border"
        >
          <a href={url} className="text-info-foreground hover:underline">
            Open {doc.name}
          </a>
        </object>
      ) : doc.mime.startsWith("image/") && doc.mime !== "image/svg+xml" ? (
        <img
          src={url}
          alt={doc.name}
          className="max-h-96 w-full rounded-md border object-contain"
        />
      ) : (
        <p className="text-muted-foreground">No preview for this kind of file.</p>
      )}
      <div className="flex gap-1.5">
        <Button size="xs" variant="outline" render={<a href={url} download={doc.name} />}>
          Download
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          Open full size
        </Button>
      </div>
    </div>
  );
}
