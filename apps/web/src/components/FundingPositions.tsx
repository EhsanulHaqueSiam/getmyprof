import type { Position } from "@getmyprof/contracts";
import { ExternalLinkIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const th =
  "sticky top-0 border-b border-input bg-background px-3 py-1.5 text-left font-medium text-muted-foreground text-xs whitespace-nowrap";

/** "closes in 9 days", "closed", or "no deadline". */
const closes = (p: Position) =>
  p.daysLeft === null
    ? "no deadline"
    : p.daysLeft < 0
      ? "closed"
      : p.daysLeft === 0
        ? "closes today"
        : `${p.daysLeft} days`;

/** Funding's Positions tab: advertised PhD positions, soonest deadline first. */
export function PositionsTable({
  positions,
  picked,
  onPick,
  onAdd,
}: {
  positions: Position[];
  picked: Position | null;
  onPick: (p: Position) => void;
  onAdd: (p: Position) => void;
}) {
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr>
          {["Position", "Contact", "School", "Funding", "Closes", "In sheet"].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr
            key={`${p.source}${p.id}`}
            data-testid="position-row"
            onClick={() => onPick(p)}
            className={cn(
              "cursor-pointer transition-colors hover:bg-secondary",
              picked === p && "bg-primary/7",
              ((p.daysLeft ?? 0) < 0 || p.fit === 0) && "opacity-45",
            )}
          >
            <td className="h-9 max-w-[240px] truncate border-b px-3 text-secondary-label">
              {p.title}
            </td>
            <td className="border-b px-3 font-medium whitespace-nowrap">
              {p.professor || <span className="text-muted-foreground">none named</span>}
            </td>
            <td className="max-w-[140px] truncate border-b px-3 text-secondary-label">
              {p.university}
            </td>
            <td className="max-w-[200px] truncate border-b px-3 text-secondary-label">
              {p.funding || "?"}
            </td>
            <td
              className={cn(
                "border-b px-3 whitespace-nowrap tabular-nums",
                p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft < 14
                  ? "text-warning-foreground"
                  : "text-secondary-label",
              )}
            >
              {closes(p)}
            </td>
            <td
              className={cn(
                "border-b px-3 whitespace-nowrap",
                p.inSheet ? "text-success-foreground" : "text-muted-foreground",
              )}
            >
              {p.inSheet ? (
                "yes"
              ) : p.fit === 0 ? (
                "off topic"
              ) : p.professor ? (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(p);
                  }}
                >
                  <PlusIcon /> Add PI
                </Button>
              ) : (
                "no contact"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The picked posting in Funding's side panel. */
export function PositionDetail({
  p,
  onVet,
  onAdd,
}: {
  p: Position;
  onVet: (p: Position) => void;
  onAdd: (p: Position) => void;
}) {
  return (
    <>
      <div className="text-muted-foreground text-xs">
        {p.source} {p.id}
        {p.posted ? ` · posted ${p.posted}` : ""}
        {p.deadline ? ` · closes ${p.deadline}` : ""}
      </div>
      <h2 className="font-semibold text-sm leading-snug">{p.title}</h2>
      <div className="flex flex-wrap gap-3 text-muted-foreground text-xs">
        <span>
          Contact <b className="text-foreground">{p.professor || "none named"}</b>
        </span>
        <span>
          {p.university}
          {p.country ? `, ${p.country}` : ""}
        </span>
      </div>
      {p.funding ? <p className="text-foreground text-xs">{p.funding}</p> : null}
      {p.abstract ? (
        <p className="text-secondary-label text-xs leading-relaxed">{p.abstract}</p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {p.inSheet
          ? "In the sheet."
          : p.professor
            ? "Not in the sheet. A posted opening means money and a seat this cycle."
            : "The posting names no supervisor. A thread can find who leads it."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" onClick={() => onVet(p)}>
          <MessageSquareIcon /> Vet in a thread
        </Button>
        {!p.inSheet && p.professor ? (
          <Button variant="outline" size="xs" onClick={() => onAdd(p)}>
            <PlusIcon /> Add as candidate
          </Button>
        ) : null}
        <Button
          variant="ghost-muted"
          size="xs"
          render={<a href={p.url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon /> {new URL(p.url).host}
        </Button>
      </div>
    </>
  );
}
