import { useState } from "react";
import { encode } from "uqr";
import { Button } from "~/components/ui/button";
import { useStore } from "~/state/store";

/** The link as a QR code a phone camera opens: dark modules on a light square, quiet zone included. */
function QrCode({ text }: { text: string }) {
  const { data, size } = encode(text, { border: 4 });
  const modules = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="size-36"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${text}`}
    >
      <rect width={size} height={size} className="fill-foreground" />
      <path d={modules} className="fill-background" />
    </svg>
  );
}

/** Settings' row for opening getmyprof on a phone or laptop over the tailnet. */
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
      {link.served ? <QrCode text={link.url} /> : null}
      <span className="text-muted-foreground">
        {link.served
          ? "Open it on any device signed in to your tailnet. The agent keeps running here."
          : "Not served yet: run scripts/dev-local.sh share on this machine, then open it."}
      </span>
    </div>
  );
}
