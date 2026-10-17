import { type ReactNode, useState } from "react";
import { Input } from "~/components/ui/input";
import { Toggle } from "~/components/ui/toggle";

/**
 * One value in a multi-select list, or an on/off preference: the kit Toggle, pressed when on.
 * Setup and Settings share these. A pick of exactly one value is a ToggleGroup instead.
 */
export function Chip({
  on,
  children,
  onClick,
}: {
  on: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Toggle size="xs" variant="outline" pressed={on} onPressedChange={onClick} className="px-2.5">
      {children}
    </Toggle>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-1.5 border-b py-3 md:grid-cols-[160px_minmax(0,1fr)] md:gap-4">
      <span className="pt-0.5 text-muted-foreground text-xs">{label}</span>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

/** Chips for a string list, plus a box to add your own. */
export function ListEditor({
  values,
  suggested,
  onChange,
}: {
  values: string[];
  suggested: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const all = [...new Set([...suggested, ...values])];
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((v) => (
        <Chip
          key={v}
          on={values.includes(v)}
          onClick={() =>
            onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
          }
        >
          {v}
        </Chip>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) onChange([...values, draft.trim()]);
          setDraft("");
        }}
      >
        <Input
          size="compact"
          className="w-24"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add"
          aria-label="Add"
        />
      </form>
    </div>
  );
}
