import type { HubStudent } from "@getmyprof/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ReportView } from "~/components/ReportView";
import { since } from "~/lib/format";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/students_/$id")({ component: StudentReport });

/** One student's whole progress report, as their install last sent it to this hub. */
function StudentReport() {
  const { id } = Route.useParams();
  const app = useStore((s) => s.app);
  const [student, setStudent] = useState<HubStudent | null | undefined>();
  useEffect(() => {
    void call("hub.students", {}).then((all) => setStudent(all.find((s) => s.id === id) ?? null));
  }, [app, id]);
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="max-w-3xl px-8 py-6">
        <div className="mb-4 flex items-baseline gap-2 text-xs">
          <Link to="/students" className="text-muted-foreground hover:text-foreground">
            Students
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-foreground">{student?.name ?? ""}</span>
          {student?.syncedAt ? (
            <span className="ml-auto text-muted-foreground">synced {since(student.syncedAt)}</span>
          ) : null}
        </div>
        {student?.report ? (
          <ReportView report={student.report} />
        ) : student === undefined ? null : (
          <p className="text-muted-foreground text-xs">
            {student ? "No report from them yet." : "No such student."}
          </p>
        )}
      </div>
    </div>
  );
}
