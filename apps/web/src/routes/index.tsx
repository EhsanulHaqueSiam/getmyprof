import { CHECKS, type Check } from "@gradcode/contracts";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { createFileRoute } from "@tanstack/react-router";
import { RotateCwIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useConnectionStore } from "~/state/connectionStore";

export const Route = createFileRoute("/")({ component: Home });

const LABEL = {
  claude: "Claude Code CLI",
  scout: "gradhunt scout.py",
  treg: "treg CLI",
} satisfies Record<Check, string>;

const STATUS_LABEL = { connecting: "connecting", live: "connected", down: "reconnecting" } as const;

/** Placeholder until a shell is picked from docs/mocks/phase1.html. Proves web, server and ws are wired. */
function Home() {
  const status = useConnectionStore((s) => s.status);
  const health = useConnectionStore((s) => s.health);
  const checkHealth = useConnectionStore((s) => s.checkHealth);
  const [listRef] = useAutoAnimate<HTMLDListElement>();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="font-semibold text-xl tracking-tight">gradcode</h1>
        <p className="mt-0.5 text-muted-foreground">
          The shell comes next. The design is docs/mocks/phase1.html.
        </p>
      </div>

      <div className="flex items-center gap-2 text-secondary-label">
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "live" ? "bg-success" : "bg-muted-foreground",
          )}
        />
        <span className="text-foreground">{health?.host ?? "server"}</span>
        <span
          data-testid="ws-status"
          className={status === "live" ? "text-success-foreground" : "text-muted-foreground"}
        >
          {STATUS_LABEL[status]}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Recheck tools"
                onClick={() => void checkHealth()}
              >
                <RotateCwIcon />
              </Button>
            }
          />
          <TooltipPopup>Recheck tools</TooltipPopup>
        </Tooltip>
      </div>

      <dl ref={listRef} className="grid grid-cols-[12rem_1fr] border-t">
        {health &&
          CHECKS.map((name) => (
            <div
              key={name}
              data-testid={`check-${name}`}
              className="col-span-2 grid grid-cols-subgrid border-b py-2"
            >
              <dt className="text-secondary-label">{LABEL[name]}</dt>
              <dd
                className={
                  health.checks[name] ? "text-success-foreground" : "text-destructive-foreground"
                }
              >
                {health.checks[name] ? "found" : "missing"}
              </dd>
            </div>
          ))}
      </dl>
    </main>
  );
}
