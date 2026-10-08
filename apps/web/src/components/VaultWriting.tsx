import { type WritingKind } from "@getmyprof/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Choice, Table, Td } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { citations, WRITING_LABEL } from "~/lib/writing";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const KIND_LABEL = WRITING_LABEL;
const KINDS = ["sop", "cv", "essay"] as const satisfies WritingKind[];

/** Asks the agent for a new piece: a statement for a program, a CV, or an essay for a scholarship. */
function NewPiece() {
  const vault = useStore((s) => s.vault);
  const navigate = useNavigate();
  const [kind, setKind] = useState<WritingKind>("sop");
  const [target, setTarget] = useState("");
  const options =
    kind === "sop"
      ? (vault?.programs ?? []).map((p) => [p.id, `${p.university} · ${p.name}`] as const)
      : kind === "essay"
        ? (vault?.scholarships ?? []).map((s) => [s.id, s.name] as const)
        : [];
  const picked = options.find(([id]) => id === target)?.[0] ?? options[0]?.[0] ?? null;
  return (
    <div className="flex items-center gap-1.5">
      <Choice
        label="What to write"
        value={kind}
        options={KINDS}
        labels={KIND_LABEL}
        onChange={(k) => {
          setKind(k);
          setTarget("");
        }}
      />
      {options.length ? (
        <select
          aria-label="For"
          value={picked ?? ""}
          onChange={(e) => setTarget(e.target.value)}
          className="h-6.5 max-w-56 rounded-md border border-input bg-background px-1.5 text-foreground text-xs outline-none"
        >
          {options.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      ) : kind === "cv" ? null : (
        <span className="text-muted-foreground text-xs">
          File a {kind === "sop" ? "program" : "scholarship"} first
        </span>
      )}
      <Button
        size="xs"
        variant="outline"
        disabled={kind !== "cv" && !picked}
        onClick={async () => {
          const t = await call("writing.start", {
            kind,
            programId: kind === "sop" ? picked : null,
            scholarshipId: kind === "essay" ? picked : null,
            basedOn: null,
          });
          void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
        }}
      >
        Write
      </Button>
    </div>
  );
}

/** Every piece the agent wrote, whether it can be exported, and a way to start a new one. */
export function VaultWriting() {
  const vault = useStore((s) => s.vault);
  const facts = useStore((s) => s.app)?.facts ?? [];
  const pieces = vault?.writing ?? [];
  const forWhat = (programId: string | null, scholarshipId: string | null) => {
    const p = vault?.programs.find((x) => x.id === programId);
    const s = vault?.scholarships.find((x) => x.id === scholarshipId);
    return p ? `${p.university} · ${p.name}` : (s?.name ?? "any");
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-4 py-2">
        <h1 className="mr-auto font-semibold text-sm">Writing</h1>
        <NewPiece />
      </header>
      <Table
        head={["Piece", "For", "Draft", "Export"]}
        widths={["auto", "220px", "60px", "160px"]}
        empty={
          pieces.length
            ? null
            : "Nothing written yet. Pick what to write and the agent drafts it from your facts."
        }
        testId="writing"
      >
        {pieces.map((w) => {
          const blocked = citations(w, facts).filter((c) => !c.ok).length;
          return (
            <tr key={w.id} className="transition-colors hover:bg-secondary">
              <Td strong className="max-w-none">
                <Link to="/vault/writing/$id" params={{ id: w.id }} className="hover:underline">
                  {w.title || KIND_LABEL[w.kind]}
                </Link>
              </Td>
              <Td muted>{forWhat(w.programId, w.scholarshipId)}</Td>
              <Td muted>{w.draft}</Td>
              <Td className={cn(blocked ? "text-warning-foreground" : "text-success-foreground")}>
                {blocked === 1
                  ? "1 claim needs proof"
                  : blocked
                    ? `${blocked} claims need proof`
                    : "ready"}
              </Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
