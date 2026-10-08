import { DropToFile } from "~/components/DropToFile";
import type { FileItem } from "@getmyprof/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { VaultApplications } from "~/components/VaultApplications";
import { VaultDocuments } from "~/components/VaultDocuments";
import { VaultFacts } from "~/components/VaultFacts";
import { VaultLifeline } from "~/components/VaultLifeline";
import { VaultPrograms, VaultScholarships } from "~/components/VaultOpportunities";
import { VaultOffers } from "~/components/VaultOffers";
import { VaultWriting } from "~/components/VaultWriting";
import { cn } from "~/lib/utils";
import { comingUp } from "~/lib/vault";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const SECTIONS = [
  "lifeline",
  "facts",
  "documents",
  "writing",
  "scholarships",
  "programs",
  "applications",
  "offers",
  "toFile",
] as const;
type Section = (typeof SECTIONS)[number];

export const Route = createFileRoute("/_shell/vault")({
  component: VaultPage,
  // Optional, so a plain link to /vault opens the Lifeline.
  validateSearch: (s: Record<string, unknown>): { section?: Section } => {
    const section = SECTIONS.find((x) => x === s.section);
    return section ? { section } : {};
  },
});

function Nav({ section, go }: { section: Section; go: (s: Section) => void }) {
  const app = useStore((s) => s.app);
  const v = useStore((s) => s.vault);
  const item = (id: Section, label: string, count: number | undefined) => (
    <button
      key={id}
      type="button"
      onClick={() => go(id)}
      className={cn(
        "flex h-8 w-full items-center rounded-lg px-2.5 text-left text-secondary-label text-sm transition-colors hover:bg-accent",
        section === id && "bg-secondary text-foreground",
      )}
    >
      {label}
      <span className="ml-auto text-muted-foreground text-xs tabular-nums">{count || ""}</span>
    </button>
  );
  return (
    <nav className="flex flex-col gap-px border-r px-2 py-3">
      <div className="px-2.5 pb-1 text-muted-foreground text-xs">You</div>
      {item("lifeline", "Lifeline", undefined)}
      {item("facts", "Facts", app?.facts.length)}
      {item("documents", "Documents", v?.documents.length)}
      {item("writing", "Writing", v?.writing.length)}
      <div className="px-2.5 pt-3 pb-1 text-muted-foreground text-xs">Opportunities</div>
      {item("scholarships", "Scholarships", v?.scholarships.length)}
      {item("programs", "Programs", v?.programs.length)}
      {item("applications", "Applications", v?.applications.length)}
      {item("offers", "Offers", v?.offers.length)}
      <div className="px-2.5 pt-3 pb-1 text-muted-foreground text-xs">Inbox</div>
      {item("toFile", "To file", v?.toFile.length)}
    </nav>
  );
}

const what = (f: FileItem) =>
  f.kind === "scholarship"
    ? `${f.item.name} (${f.item.sponsor}). Add to Scholarships?`
    : `${f.item.university} · ${f.item.name}. Add to Programs?`;

/** The agent's finds waiting for a click, and what's coming up. */
function Side() {
  const v = useStore((s) => s.vault);
  const applicant = useStore((s) => s.app?.applicant);
  if (!v) return <aside className="border-l" />;
  const upcoming = comingUp(v, new Date(), applicant);
  return (
    <aside className="min-h-0 overflow-y-auto border-l px-4 py-3 text-xs">
      <div className="mb-1 text-muted-foreground">To file · {v.toFile.length}</div>
      {v.toFile.length === 0 ? (
        <p className="text-muted-foreground">Nothing waiting. The agent's finds land here first.</p>
      ) : null}
      {v.toFile.map((f) => (
        <div key={f.id} className="border-b py-2" data-testid="to-file">
          <div className="flex gap-2">
            <span className="w-8 shrink-0 font-mono font-semibold text-3xs text-info-foreground uppercase">
              {f.kind === "scholarship" ? "Award" : "Prog"}
            </span>
            <span className="text-foreground">{what(f)}</span>
          </div>
          <p className="mt-0.5 pl-10 text-muted-foreground">{f.why}</p>
          <div className="mt-1.5 flex justify-end gap-1">
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => void call("toFile.resolve", { id: f.id, decision: "dismiss" })}
            >
              Dismiss
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void call("toFile.resolve", { id: f.id, decision: "file" })}
            >
              File
            </Button>
          </div>
        </div>
      ))}
      <div className="mt-4 mb-1 text-muted-foreground">Coming up</div>
      {upcoming.length === 0 ? (
        <p className="text-muted-foreground">
          No deadlines or expiring documents in the next weeks.
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5" data-testid="coming-up">
        {upcoming.map((u) => (
          <li key={u.id} className={u.urgent ? "text-warning-foreground" : "text-secondary-label"}>
            {u.text}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** The vault: facts and documents about you, opportunities, and the agent's finds To file. */
function VaultPage() {
  const { section = "lifeline" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const go = (s: Section) => void navigate({ search: { section: s } });
  // The Lifeline brings its own panel; To file is the side column, given the whole page.
  const wide = section === "lifeline" || section === "toFile";
  return (
    <div
      className={cn(
        // On a phone the sections, the content and the side stack in one scrolling column.
        "grid min-w-0 flex-1 grid-cols-1 max-md:auto-rows-max max-md:overflow-y-auto",
        wide ? "md:grid-cols-[200px_minmax(0,1fr)]" : "md:grid-cols-[200px_minmax(0,1fr)_300px]",
      )}
    >
      <Nav section={section} go={go} />
      <div className="flex min-h-0 min-w-0 flex-col">
        {section === "lifeline" ? <VaultLifeline /> : null}
        {section === "toFile" ? (
          <DropToFile>
            <Side />
          </DropToFile>
        ) : null}
        {section === "facts" ? <VaultFacts /> : null}
        {section === "documents" ? <VaultDocuments /> : null}
        {section === "writing" ? <VaultWriting /> : null}
        {section === "scholarships" ? <VaultScholarships /> : null}
        {section === "programs" ? (
          <VaultPrograms onOpenApplication={() => go("applications")} />
        ) : null}
        {section === "applications" ? <VaultApplications /> : null}
        {section === "offers" ? <VaultOffers /> : null}
      </div>
      {wide ? null : <Side />}
    </div>
  );
}
