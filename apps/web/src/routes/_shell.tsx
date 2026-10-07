import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { PanelLeftIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Sidebar } from "~/components/Sidebar";
import { cn } from "~/lib/utils";
import { useStore } from "~/state/store";

/** The app frame: inbox sidebar and the page. First run happens outside it, at /setup. */
function Shell() {
  const app = useStore((s) => s.app);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  // On a phone the sidebar covers the page, so going somewhere closes it.
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (!window.matchMedia("(min-width: 768px)").matches && useStore.getState().sidebarOpen)
      useStore.getState().toggleSidebar();
  }, [path]);
  if (app && !app.settings.setupDone) return <Navigate to="/setup" />;
  return (
    <div
      className={cn(
        "grid h-dvh grid-cols-[0px_minmax(0,1fr)] transition-[grid-template-columns] duration-240 ease-drawer",
        sidebarOpen && "md:grid-cols-[252px_minmax(0,1fr)]",
      )}
    >
      <div
        className={cn(
          "min-w-0 overflow-hidden max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:w-[252px] max-md:bg-background",
          !sidebarOpen && "invisible",
        )}
      >
        <Sidebar />
      </div>
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={toggleSidebar}
          className="fixed inset-0 z-20 bg-background/60 md:hidden"
        />
      ) : null}
      <main className="flex h-dvh min-w-0 max-md:flex-col">
        {/* On a phone a slim bar opens the sidebar from any page. */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2 md:hidden">
          <Button variant="ghost-muted" size="icon-sm" aria-label="Menu" onClick={toggleSidebar}>
            <PanelLeftIcon />
          </Button>
          <span className="font-semibold text-sm">gradcode</span>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/_shell")({ component: Shell });
