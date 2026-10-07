import { useState } from "react";
import { Button } from "~/components/ui/button";
import { disableNotify, enableNotify, notifyOn } from "~/lib/notify";

/** Settings' Notifications row: desktop alerts for Approval and Input only, per browser. */
export function NotifySettings() {
  const [on, setOn] = useState(notifyOn);
  const [note, setNote] = useState("");
  return (
    <div className="flex items-center gap-2 text-xs">
      <Button
        size="xs"
        variant={on ? "ghost-muted" : "outline"}
        onClick={async () => {
          if (on) {
            disableNotify();
            setOn(false);
            return;
          }
          const p = await enableNotify();
          setOn(p === "granted");
          setNote(p === "granted" ? "" : "The browser blocked notifications for this site.");
        }}
      >
        {on ? "Turn off" : "Turn on"}
      </Button>
      <span className="text-muted-foreground">
        {note || (on ? "On in this browser: Approval and Input only." : "Approval and Input only.")}
      </span>
    </div>
  );
}
