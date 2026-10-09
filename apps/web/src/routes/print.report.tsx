import type { ProgressReport } from "@getmyprof/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ReportView } from "~/components/ReportView";
import { call } from "~/rpc/client";

export const Route = createFileRoute("/print/report")({ component: PrintReport });

/** The progress report on paper, opened in a tab by the Report page's Save PDF; prints once loaded. */
function PrintReport() {
  const [report, setReport] = useState<ProgressReport | null>(null);
  useEffect(() => {
    void call("report.get", {}).then(setReport);
  }, []);
  useEffect(() => {
    if (report) window.print();
  }, [report]);

  if (!report) return null;
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <div className="mx-auto max-w-[760px] px-12 py-16">
        <ReportView report={report} paper />
      </div>
    </div>
  );
}
