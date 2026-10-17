import type { ReactNode } from "react";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

/** The dense table the Professors page uses: sticky header, hairline rows. Vault sections share it. */
export function Table({
  head,
  widths,
  children,
  empty,
  testId,
}: {
  head: string[];
  /** Fixed column widths ("auto" takes the rest). The table then fits its column and truncates. */
  widths?: string[];
  children: ReactNode;
  /** Shown under the header when there are no rows. */
  empty: string | null;
  testId?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto border-t" data-testid={testId}>
      <table
        className={cn("w-full border-collapse text-[12.5px]", widths && "table-fixed")}
        // Fixed columns plus 200px for the "auto" one, so it never shrinks to nothing.
        style={
          widths
            ? {
                minWidth: `calc(${widths.filter((w) => w !== "auto").join(" + ") || "0px"} + 200px)`,
              }
            : undefined
        }
      >
        {widths ? (
          <colgroup>
            {widths.map((w, i) => (
              <col key={`${head[i]}-${w}`} style={w === "auto" ? undefined : { width: w }} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="sticky top-0 border-b border-input bg-background px-3 py-1.5 text-left font-medium text-muted-foreground text-xs whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty ? (
        <div className="px-6 py-16 text-center text-muted-foreground text-xs">{empty}</div>
      ) : null}
    </div>
  );
}

/** A body cell. `strong` for the row's name, `muted` for secondary values. */
export function Td({
  children,
  strong,
  muted,
  className,
}: {
  children: ReactNode;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      title={typeof children === "string" ? children : undefined}
      className={cn(
        "h-9 max-w-[260px] truncate border-b px-3 whitespace-nowrap",
        strong && "font-medium text-foreground",
        muted ? "text-muted-foreground" : "text-secondary-label",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** A small select for a fixed set of values, labelled through `labels` or the value itself. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  labels,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  label: string;
  /** Display names for the options; raw values otherwise. */
  labels?: Record<T, string>;
}) {
  const name = (o: T) => labels?.[o] ?? o.replace("-", " ");
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const next = options.find((o) => o === v);
        if (next) onChange(next);
      }}
    >
      <SelectTrigger size="compact" aria-label={label} className="w-auto min-w-0 shrink-0">
        {/* max-content: a grid cell or flex row must not squeeze the value to nothing. */}
        <SelectValue className="min-w-max">{name(value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {name(o)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
