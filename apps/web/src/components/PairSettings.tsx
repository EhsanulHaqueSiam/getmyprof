import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useStore } from "~/state/store";

/** Settings' row for opening gradcode on a phone or laptop over the tailnet. */
export function PairSettings() {
  const link = useStore((s) => s.app?.tailnet);
  const [copied, setCopied] = useState(false);
  if (!link)
    return (
      <span className="text-muted-foreground text-xs">
        Tailscale isn't running on this machine.
      </span>
    );
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="flex items-center gap-2">
        <a href={link.url} className="font-mono text-2xs text-info-foreground hover:underline">
          {link.url}
        </a>
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={async () => {
            await navigator.clipboard.writeText(link.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </span>
      <span className="text-muted-foreground">
        {link.served
          ? "Open it on any device signed in to your tailnet. The agent keeps running here."
          : "Not served yet: run scripts/dev-local.sh share on this machine, then open it."}
      </span>
    </div>
  );
}
