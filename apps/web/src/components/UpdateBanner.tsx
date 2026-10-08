import { DesktopUpdate } from "@gradcode/contracts";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";

declare global {
  interface Window {
    /** Only inside the desktop app: its preload (apps/desktop/src/preload.ts) puts it here. */
    gradcodeDesktop?: {
      onUpdate: (listener: (update: unknown) => void) => () => void;
      act: () => void;
    };
  }
}

/** The desktop app's update line above the page. In a browser there's no bridge, so nothing. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<DesktopUpdate>({ state: "none" });
  useEffect(
    () =>
      window.gradcodeDesktop?.onUpdate((raw) => {
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
          Downloading gradcode {update.version} · {Math.round(update.percent)}%
        </span>
      ) : (
        <>
          <span className="text-secondary-label">
            {update.state === "ready"
              ? `Update ready · gradcode ${update.version}`
              : `gradcode ${update.version} is out`}
          </span>
          <Button size="micro" variant="outline" onClick={() => window.gradcodeDesktop?.act()}>
            {update.state === "ready" ? "Restart" : "Download"}
          </Button>
        </>
      )}
    </div>
  );
}
