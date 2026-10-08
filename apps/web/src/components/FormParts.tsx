import { PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "~/lib/utils";

/** A pressed-state toggle for a preference value. Setup and Settings share these. */
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
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-6.5 max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-left text-xs transition-colors",
        on
          ? "border-transparent bg-accent text-foreground before:size-1.5 before:rounded-full before:bg-primary"
          : "border-input text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
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
        className="flex h-6.5 items-center gap-1 rounded-lg border border-input px-2 text-xs"
      >
        <PlusIcon className="size-3 text-muted-foreground" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add"
          aria-label="Add"
          className="w-20 bg-transparent outline-none placeholder:text-placeholder"
        />
      </form>
    </div>
  );
}
