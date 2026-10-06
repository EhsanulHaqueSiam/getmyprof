import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { Sidebar } from "~/components/Sidebar";
import { cn } from "~/lib/utils";
import { useStore } from "~/state/store";

/** The app frame: inbox sidebar and the page. First run happens outside it, at /setup. */
function Shell() {
  const app = useStore((s) => s.app);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  if (app && !app.settings.setupDone) return <Navigate to="/setup" />;
  return (
    <div
      className={cn(
        "grid h-dvh transition-[grid-template-columns] duration-240 ease-drawer",
        sidebarOpen ? "grid-cols-[252px_minmax(0,1fr)]" : "grid-cols-[0px_minmax(0,1fr)]",
      )}
    >
      <div className={cn("min-w-0 overflow-hidden", !sidebarOpen && "invisible")}>
        <Sidebar />
      </div>
      <main className="flex h-dvh min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createFileRoute("/_shell")({ component: Shell });
