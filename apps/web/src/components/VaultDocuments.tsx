import { DocKind } from "@gradcode/contracts";
import { Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { Choice, Table, Td } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { toBase64 } from "~/lib/files";
import { cn } from "~/lib/utils";
import { daysLeft, due } from "~/lib/vault";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

/** Every file the applicant keeps: CV, transcript, passport, scores. Expiry dates feed Coming up. */
export function VaultDocuments() {
  const docs = useStore((s) => s.vault)?.documents ?? [];
  const [kind, setKind] = useState<DocKind>("cv");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      await call("documents.upload", {
        name: file.name,
        kind,
        mime: file.type,
        base64: await toBase64(file),
        expires: expires || null,
      });
      setExpires("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <h1 className="mr-auto font-semibold text-sm">Documents</h1>
        <Choice label="Document kind" value={kind} options={DocKind.options} onChange={setKind} />
        <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
          expires
          <input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            aria-label="Expires"
            className="h-6.5 rounded-md border border-input bg-background px-1.5 text-foreground text-xs outline-none"
          />
        </label>
        <label className="cursor-pointer">
          <input
            type="file"
            aria-label="Upload document"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <span className="flex h-7 items-center gap-1.5 rounded-lg border border-input px-2.5 text-xs transition-colors hover:bg-accent">
            <UploadIcon className="size-3.5" />
            {busy ? "Uploading" : "Upload"}
          </span>
        </label>
      </header>
      <Table
        head={["Document", "Kind", "Size", "Expires", "Added", ""]}
        widths={["auto", "100px", "80px", "200px", "100px", "40px"]}
        empty={docs.length ? null : "No documents yet. Upload your CV, transcript and passport."}
        testId="documents"
      >
        {docs.map((d) => (
          <tr key={d.id} className="transition-colors hover:bg-secondary">
            <Td strong className="max-w-none">
              <a
                href={`/api/files/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-muted-foreground underline-offset-2 hover:text-foreground"
              >
                {d.name}
              </a>
            </Td>
            <Td muted>{d.kind}</Td>
            <Td muted>{size(d.size)}</Td>
            <Td className={cn(d.expires && daysLeft(d.expires) <= 90 && "text-warning-foreground")}>
              {d.expires ? `${d.expires} · ${due(d.expires)}` : ""}
            </Td>
            <Td muted>{d.uploadedAt.slice(0, 10)}</Td>
            <Td muted className="w-8">
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label={`Remove ${d.name}`}
                onClick={() => void call("vault.remove", { kind: "document", id: d.id })}
              >
                <Trash2Icon />
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
