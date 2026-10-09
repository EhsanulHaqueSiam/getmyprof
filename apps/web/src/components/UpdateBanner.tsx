import { DesktopUpdate } from "@getmyprof/contracts";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";

declare global {
  interface Window {
    /** Only inside the desktop app: its preload (apps/desktop/src/preload.ts) puts it here. */
    getmyprofDesktop?: {
      onUpdate: (listener: (update: unknown) => void) => () => void;
      act: () => void;
      /** An application portal in its own window: open it, read its fields, fill some (ApplyHelp). */
      portal?: {
        open: (url: string) => Promise<void>;
        read: () => Promise<unknown>;
        fill: (values: { key: string; value: string }[]) => Promise<unknown>;
      };
    };
  }
}

/** The desktop app's update line above the page. In a browser there's no bridge, so nothing. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<DesktopUpdate>({ state: "none" });
  useEffect(
    () =>
      window.getmyprofDesktop?.onUpdate((raw) => {
        const parsed = DesktopUpdate.safeParse(raw);
        if (parsed.success) setUpdate(parsed.data);
      }),
    [],
  );
  if (update.state === "none") return null;
  return (
    <div
      data-testid="update-banner"
      className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs"
    >
      {update.state === "downloading" ? (
        <span className="text-muted-foreground tabular-nums">
          Downloading getmyprof {update.version} · {Math.round(update.percent)}%
        </span>
      ) : (
        <>
          <span className="text-secondary-label">
            {update.state === "ready"
              ? `Update ready · getmyprof ${update.version}`
              : `getmyprof ${update.version} is out`}
          </span>
          <Button size="micro" variant="outline" onClick={() => window.getmyprofDesktop?.act()}>
            {update.state === "ready" ? "Restart" : update.inPlace ? "Update" : "Download"}
          </Button>
        </>
      )}
    </div>
  );
}
