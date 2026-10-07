import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { checks, citations, mustProve, paragraphs, plainText, strayMarkers } from "~/lib/writing";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/print/$id")({ component: PrintView });

const KIND_LABEL = {
  sop: "Statement of Purpose",
  cv: "Curriculum Vitae",
  essay: "Essay",
  prep: "Interview Preparation",
  letter: "Letter",
  note: "Note",
  visa: "Visa Steps",
} as const;

/**
 * A piece as it leaves the app: on paper, citations gone, opened in a tab and printed to PDF.
 * It refuses while any claim lacks proof, the same rule the Writer's Export button follows.
 */
function PrintView() {
  const { id } = Route.useParams();
  const w = useStore((s) => s.vault)?.writing.find((x) => x.id === id);
  const app = useStore((s) => s.app);
  const ready =
    !!w &&
    !!app &&
    (!mustProve(w) ||
      (citations(w, app.facts).every((c) => c.ok) &&
        strayMarkers(w).length === 0 &&
        !checks(w, { named: [], applicant: app.applicant }).scoreClaimed));

  useEffect(() => {
    if (ready) window.print();
  }, [ready]);

  if (!app) return null;
  if (!w) return <div className="p-10 text-sm">No such piece.</div>;
  if (!ready)
    return (
      <div className="p-10 text-sm">
        This piece has a claim without proof. Fix it in the Writer first.
      </div>
    );
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <article className="mx-auto max-w-[42rem] px-12 py-16 font-serif text-[12pt] leading-relaxed">
        <h1 className="mb-6 font-semibold text-[14pt]">{KIND_LABEL[w.kind]}</h1>
        {paragraphs(plainText(w)).map((p) => (
          <p key={p.key} className="mb-4 whitespace-pre-wrap">
            {p.text}
          </p>
        ))}
      </article>
    </div>
  );
}
