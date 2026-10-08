import { type ReactNode, useState } from "react";
import { guessKind, toBase64 } from "~/lib/files";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";

/**
 * To file takes files dropped on it (or chosen): each goes to the Vault's documents, its kind
 * guessed from its name. Mail attachments land there on their own when replies sync.
 */
export function DropToFile({ children }: { children: ReactNode }) {
  const [over, setOver] = useState(false);
  const [filed, setFiled] = useState<string[]>([]);
  const file = async (list: FileList) => {
    for (const f of list) {
      const doc = await call("documents.upload", {
        name: f.name,
        kind: guessKind(f.name, "other"),
        mime: f.type || "application/octet-stream",
        base64: await toBase64(f),
        expires: null,
      });
      setFiled((names) => [...names, doc.name]);
    }
  };
  return (
    <div
      data-testid="drop-to-file"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void file(e.dataTransfer.files);
      }}
      className={cn("flex min-h-0 flex-1 flex-col", over && "bg-primary/7")}
    >
      <label className="cursor-pointer border-b px-4 py-2 text-muted-foreground text-xs">
        Drop files here, or choose them: a CV, a transcript, a letter. They go to Documents.
        {filed.length ? <span className="text-foreground"> Filed: {filed.join(", ")}.</span> : null}
        <input
          type="file"
          multiple
          aria-label="Add files to the Vault"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void file(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {children}
    </div>
  );
}
