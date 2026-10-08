import type { ScopeItem } from "@gradcode/contracts";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "~/rpc/client";

/** The schools a loop works on: chips, and a box that suggests the sheet's schools. */
export function ScopeEditor({
  value,
  onChange,
}: {
  value: ScopeItem[];
  onChange: (scope: ScopeItem[]) => void;
}) {
  const [schools, setSchools] = useState<string[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    void call("records.list", {}).then((rows) =>
      setSchools([...new Set(rows.map((r) => r.university))].toSorted()),
    );
  }, []);
  const add = () => {
    const name = text.trim();
    if (name && !value.some((x) => x.name === name)) onChange([...value, { kind: "school", name }]);
    setText("");
  };
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap gap-1">
        {value.map((x) => (
          <span
            key={x.name}
            className="flex h-6 items-center gap-1 rounded-md border border-input pl-2 text-secondary-label"
          >
            {x.name}
            <button
              type="button"
              aria-label={`Remove ${x.name}`}
              onClick={() => onChange(value.filter((y) => y.name !== x.name))}
              className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        list="loop-schools"
        value={text}
        aria-label="Add a school"
        placeholder={value.length ? "Add a school" : "Scope: every school (add one to narrow it)"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        className="h-7 rounded-lg border border-input bg-transparent px-2 text-foreground outline-none placeholder:text-placeholder"
      />
      <datalist id="loop-schools">
        {schools.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </div>
  );
}
