import type { ProgressReport } from "@getmyprof/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ReportView } from "~/components/ReportView";
import { Button } from "~/components/ui/button";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/report")({ component: ReportPage });

/** The progress report in the app. Save PDF opens /print/report, which prints it on paper. */
function ReportPage() {
  const recordsVersion = useStore((s) => s.recordsVersion);
  const vault = useStore((s) => s.vault);
  const conversations = useStore((s) => s.conversations);
  const [report, setReport] = useState<ProgressReport | null>(null);
  // Records, the vault and outreach feed it; a change to any reloads it.
  useEffect(() => {
    void call("report.get", {}).then(setReport);
  }, [recordsVersion, vault, conversations]);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 py-7">
        {report ? <ReportView report={report} /> : null}
        <div className="mt-5">
          <Button
            size="xs"
            variant="outline"
            onClick={() => window.open("/print/report", "_blank", "noopener")}
          >
            Save PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
