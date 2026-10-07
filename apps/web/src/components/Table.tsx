import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/** The dense table the Professors page uses: sticky header, hairline rows. Vault sections share it. */
export function Table({
  head,
  children,
  empty,
  testId,
}: {
  head: string[];
  children: ReactNode;
  /** Shown under the header when there are no rows. */
  empty: string | null;
  testId?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto border-t" data-testid={testId}>
      <table className="w-full border-collapse text-[12.5px]">
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

/** Small native select styled like the page's inputs. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        const next = options.find((o) => o === e.target.value);
        if (next) onChange(next);
      }}
      className="h-6.5 rounded-md border border-input bg-background px-1.5 text-foreground text-xs outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace("-", " ")}
        </option>
      ))}
    </select>
  );
}
