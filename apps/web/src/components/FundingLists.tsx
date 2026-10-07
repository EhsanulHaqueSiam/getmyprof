import { Link } from "@tanstack/react-router";
import { useStore } from "~/state/store";

const th =
  "sticky top-0 border-b border-input bg-background px-3 py-1.5 text-left font-medium text-muted-foreground text-xs whitespace-nowrap";
const td = "h-9 border-b px-3 text-secondary-label";

/** Funding's Programs tab: programs from the Vault, by deadline, with how they fund admits. */
export function ProgramsTable() {
  const vault = useStore((s) => s.vault);
  const programs = (vault?.programs ?? []).toSorted((a, b) =>
    (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
  );
  if (!programs.length)
    return <Empty>No programs yet. Threads file the ones they find in the Vault's To file.</Empty>;
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr>
          {["Program", "School", "Funding", "Fee", "Deadline"].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {programs.map((p) => (
          <tr key={p.id} data-testid="program-row">
            <td className={`${td} font-medium text-foreground`}>{p.name}</td>
            <td className={td}>{p.university}</td>
            <td className={`${td} max-w-[280px] truncate`}>{p.funding || "?"}</td>
            <td className={td}>{p.fee || "?"}</td>
            <td className={`${td} tabular-nums`}>{p.deadline ?? "?"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Funding's Fellowships tab: scholarships from the Vault, by deadline. */
export function FellowshipsTable() {
  const vault = useStore((s) => s.vault);
  const list = (vault?.scholarships ?? []).toSorted((a, b) =>
    (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
  );
  if (!list.length)
    return (
      <Empty>No fellowships yet. Threads file the ones open to you in the Vault's To file.</Empty>
    );
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr>
          {["Fellowship", "Sponsor", "Study in", "Amount", "Deadline", "Status"].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {list.map((s) => (
          <tr key={s.id} data-testid="fellowship-row">
            <td className={`${td} font-medium text-foreground`}>
              <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                {s.name}
              </a>
            </td>
            <td className={td}>{s.sponsor}</td>
            <td className={td}>{s.studyIn}</td>
            <td className={`${td} max-w-[200px] truncate`}>{s.amount || "?"}</td>
            <td className={`${td} tabular-nums`}>{s.deadline ?? "?"}</td>
            <td className={td}>{s.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <div className="px-6 py-16 text-center text-muted-foreground text-xs">
      {children}{" "}
      <Link to="/vault" className="text-info-foreground hover:underline">
        Open the Vault
      </Link>
    </div>
  );
}
