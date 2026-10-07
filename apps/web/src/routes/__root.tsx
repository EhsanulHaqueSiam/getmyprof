import { createRootRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CommandPalette } from "~/components/CommandPalette";
import { TooltipProvider } from "~/components/ui/tooltip";
import { OPEN_THREAD } from "~/lib/notify";
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

  // A clicked desktop notification opens its thread.
  useEffect(() => {
    const open = (e: Event) => {
      if (e instanceof CustomEvent && typeof e.detail === "string")
        void navigate({ to: "/t/$threadId", params: { threadId: e.detail } });
    };
    window.addEventListener(OPEN_THREAD, open);
    return () => window.removeEventListener(OPEN_THREAD, open);
  }, [navigate]);

  return (
    <TooltipProvider>
      <Outlet />
      <CommandPalette />
    </TooltipProvider>
  );
}

export const Route = createRootRoute({ component: Root });
