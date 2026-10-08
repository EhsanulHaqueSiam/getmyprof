import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Kbd } from "~/components/ui/kbd";
import { cn } from "~/lib/utils";

/** A sidebar view link: an icon, a label, and a count or a shortcut on the right. */
export function NavLink({
  to,
  icon,
  label,
  count,
  kbd,
  accent,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  count?: number | undefined;
  kbd?: string;
  accent?: boolean;
}) {
  return (
    <Link
      to={to}
      className="flex h-8 items-center gap-2.5 rounded-lg px-2 text-secondary-label transition-colors duration-150 hover:bg-accent hover:text-foreground [&.active]:bg-secondary [&.active]:text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground"
      activeOptions={{ exact: to === "/" }}
    >
      {icon}
      {label}
      {kbd ? <Kbd className="ml-auto bg-transparent">{kbd}</Kbd> : null}
      {count ? (
        <span
          className={cn(
            "ml-auto text-xs tabular-nums",
            accent ? "text-info-foreground" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
