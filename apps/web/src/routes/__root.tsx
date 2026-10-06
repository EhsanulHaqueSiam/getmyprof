import { createRootRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CommandPalette } from "~/components/CommandPalette";
import { TooltipProvider } from "~/components/ui/tooltip";
import { useStore } from "~/state/store";

function Root() {
  const navigate = useNavigate();
  const setPalette = useStore((s) => s.setPalette);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette(true);
      }
      if (k === "n" || (k === "o" && e.shiftKey)) {
        e.preventDefault();
        void navigate({ to: "/" });
      }
      if (k === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setPalette, toggleSidebar]);

  return (
    <TooltipProvider>
      <Outlet />
      <CommandPalette />
    </TooltipProvider>
  );
}

export const Route = createRootRoute({ component: Root });
