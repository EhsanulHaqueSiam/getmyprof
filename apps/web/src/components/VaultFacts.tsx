import { FactKind, factStatus, type ProfileFact } from "@gradcode/contracts";
import { Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { Choice, Table, Td } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { guessKind, toBase64 } from "~/lib/files";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const TABS = ["all", ...FactKind.options] as const;
const TAB_LABEL: Record<(typeof TABS)[number], string> = {
  all: "All",
  education: "Education",
  paper: "Papers",
  project: "Projects",
  test: "Tests",
  work: "Work",
  other: "Other",
};

/** Facts about the applicant, each with its proof. On Siam's install they're hq's, read-only. */
export function VaultFacts() {
  const app = useStore((s) => s.app);
  const vault = useStore((s) => s.vault);
  const docs = vault?.documents ?? [];
  const writing = vault?.writing ?? [];
  /** "SOP x2, CV": the pieces that cite a fact. */
  const usedIn = (id: string) => {
    const kinds = writing
      .filter((w) => Object.values(w.citations).includes(id))
      .map(
        (w) =>
          ({
            sop: "SOP",
            cv: "CV",
            essay: "essay",
            prep: "prep",
            letter: "letter",
            note: "note",
            visa: "visa",
          })[w.kind],
      );
    return [...new Set(kinds)]
      .map((k) => {
        const n = kinds.filter((x) => x === k).length;
        return n > 1 ? `${k} x${n}` : k;
      })
      .join(", ");
  };
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  if (!app) return null;
  const fromHq = app.settings.profileSource === "hq";
  const facts = app.facts;
  const shown = tab === "all" ? facts : facts.filter((f) => f.kind === tab);

  const save = async (next: ProfileFact[]) => {
    await call("facts.save", { facts: next });
    await useStore.getState().loadApp();
  };
  const edit = (id: string, patch: Partial<ProfileFact>) =>
    void save(facts.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  /** Keeps the file as a document, then reads it for facts; each one cites the file as proof. */
  const addFromFile = async (file: File) => {
    setReading(file.name);
    setError("");
    setNote("");
    try {
      const base64 = await toBase64(file);
      const doc = await call("documents.upload", {
        name: file.name,
        kind: guessKind(file.name, "other"),
        mime: file.type,
        base64,
        expires: null,
      });
      const found = await call("facts.extract", { text: "", links: [], pdfBase64: base64 });
      const known = new Set(facts.map((f) => f.text.trim().toLowerCase()));
      const fresh = found.filter((f) => !known.has(f.text.trim().toLowerCase()));
      await save([...facts, ...fresh.map((f) => ({ ...f, source: doc.name }))]);
      setNote(
        fresh.length
          ? `${fresh.length} new fact${fresh.length === 1 ? "" : "s"} from ${doc.name}. Confirm the ones that are right.`
          : `Nothing new in ${doc.name}: every fact it holds is already here.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading("");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <h1 className="font-semibold text-sm">Facts</h1>
        <div className="flex gap-0.5">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "h-7 rounded-lg px-2.5 text-xs transition-colors",
                tab === t
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {fromHq ? (
          <span className="ml-auto text-muted-foreground text-xs">
            From hq, read-only. Edit them in hq.
          </span>
        ) : (
          <label className="ml-auto cursor-pointer">
            <input
              type="file"
              accept="application/pdf"
              aria-label="Add from file"
              className="hidden"
              disabled={reading !== ""}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addFromFile(f);
                e.target.value = "";
              }}
            />
            <span className="flex h-7 items-center gap-1.5 rounded-lg border border-input px-2.5 text-xs transition-colors hover:bg-accent">
              <UploadIcon className="size-3.5" />
              {reading ? `Reading ${reading}` : "Add from file"}
            </span>
          </label>
        )}
      </header>
      {error ? <div className="px-4 pb-2 text-destructive-foreground text-xs">{error}</div> : null}
      {note ? <div className="px-4 pb-2 text-muted-foreground text-xs">{note}</div> : null}
      <Table
        head={["Fact", "Kind", "Proof", "Status", "Used in", ""]}
        widths={["auto", "110px", "140px", "110px", "100px", "40px"]}
        empty={shown.length ? null : "No facts here yet. Add your CV from a file."}
        testId="facts"
      >
        {shown.map((f) => {
          const status = factStatus(f);
          const doc = docs.find((d) => d.name === f.source);
          return (
            <tr
              key={f.id}
              className="transition-colors hover:bg-secondary"
              data-testid="vault-fact"
            >
              <Td strong className="max-w-none">
                {f.text}
              </Td>
              <Td muted>
                {fromHq ? (
                  f.kind
                ) : (
                  <Choice
                    label="Kind"
                    value={f.kind}
                    options={FactKind.options}
                    onChange={(kind) => edit(f.id, { kind })}
                  />
                )}
              </Td>
              <Td muted>
                {doc ? (
                  <a
                    href={`/api/files/${doc.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-muted-foreground underline-offset-2 hover:text-foreground"
                  >
                    {f.source}
                  </a>
                ) : (
                  f.source || "none"
                )}
              </Td>
              <Td
                className={cn(
                  status === "confirmed" && "text-success-foreground",
                  (status === "needs proof" || status === "question") && "text-warning-foreground",
                )}
              >
                {status === "unconfirmed" && !fromHq ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => edit(f.id, { confirmed: true })}
                  >
                    Confirm
                  </Button>
                ) : (
                  status
                )}
              </Td>
              <Td muted>
                {usedIn(f.id) || (status === "confirmed" ? "" : "blocked from writing")}
              </Td>
              <Td muted className="w-8">
                {fromHq ? null : (
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label={`Remove ${f.text}`}
                    onClick={() => void save(facts.filter((x) => x.id !== f.id))}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
