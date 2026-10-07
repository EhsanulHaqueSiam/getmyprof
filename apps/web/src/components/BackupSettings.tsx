import { useState } from "react";
import { Button } from "~/components/ui/button";

/** Settings' row for your data: download everything, or restore a backup over this install. */
export function BackupSettings() {
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button size="xs" variant="outline" render={<a href="/api/backup" download />}>
        Download backup
      </Button>
      <label className="cursor-pointer">
        <input
          type="file"
          accept="application/json,.json"
          aria-label="Restore backup"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setNote("Restoring");
            const res = await fetch("/api/backup", { method: "POST", body: await file.text() });
            if (!res.ok) {
              setNote(`Not restored: ${await res.text()}`);
              return;
            }
            setNote("Restored. Reloading.");
            location.reload();
          }}
        />
        <span className="flex h-7 items-center rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          Restore from backup
        </span>
      </label>
      <span className="text-muted-foreground">
        {note ||
          "One file: every thread, record, draft and Vault file. Reconnect your mailbox after a restore."}
      </span>
    </div>
  );
}
