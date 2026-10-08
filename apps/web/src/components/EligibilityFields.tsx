import type { Applicant } from "@getmyprof/contracts";
import { Chip, ListEditor, Row } from "~/components/FormParts";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const TESTS = ["IELTS", "TOEFL", "Duolingo", "PTE", "GRE"];
const input = "h-7 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none";

/** First run, step 2: who the applicant is, for eligibility. Citizenship decides who may pay them. */
export function EligibilityFields({
  applicant,
  set,
}: {
  applicant: Applicant;
  set: (a: Applicant) => void;
}) {
  const patch = (p: Partial<Applicant>) => set({ ...applicant, ...p });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <div className="mb-4">
      <Row label="Citizenship">
        <ListEditor
          values={applicant.citizenship}
          suggested={[]}
          onChange={(v) => patch({ citizenship: v })}
        />
      </Row>
      <Row label="Living in">
        <input
          value={applicant.residence}
          onChange={(e) => patch({ residence: e.target.value })}
          aria-label="Living in"
          className={cn(input, "w-48")}
        />
      </Row>
      <Row label="Bachelor's length">
        <div className="flex gap-1.5">
          {[3, 4, 5].map((y) => (
            <Chip
              key={y}
              on={applicant.degreeYears === y}
              onClick={() => patch({ degreeYears: y })}
            >
              {y} years
            </Chip>
          ))}
        </div>
      </Row>
      <Row label="GPA">
        <input
          value={applicant.gpa}
          onChange={(e) => patch({ gpa: e.target.value })}
          placeholder="3.8"
          aria-label="GPA"
          className={cn(input, "w-24")}
        />
        <span className="mx-1.5 text-muted-foreground text-xs">on a scale of</span>
        <input
          value={applicant.gpaScale}
          onChange={(e) => patch({ gpaScale: e.target.value })}
          placeholder="4.00"
          aria-label="GPA scale"
          className={cn(input, "w-20")}
        />
      </Row>
      <Row label="Tests">
        <div className="flex flex-col gap-1.5">
          {applicant.tests.map((t, i) => {
            const setTest = (p: Partial<Applicant["tests"][number]>) =>
              patch({ tests: applicant.tests.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              // oxlint-disable-next-line react/no-array-index-key -- test rows have no identity; they are only ever appended
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <select
                  value={t.name}
                  onChange={(e) => setTest({ name: e.target.value })}
                  aria-label="Test"
                  className={cn(input, "bg-background")}
                >
                  {TESTS.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
                {(["taken", "booked", "planned"] as const).map((s) => (
                  <Chip key={s} on={t.status === s} onClick={() => setTest({ status: s })}>
                    {s}
                  </Chip>
                ))}
                <input
                  type="date"
                  value={t.date}
                  onChange={(e) => setTest({ date: e.target.value })}
                  aria-label="Test date"
                  className={input}
                />
                {t.status === "taken" ? (
                  <input
                    value={t.score}
                    onChange={(e) => setTest({ score: e.target.value })}
                    placeholder="score"
                    aria-label="Score"
                    className={cn(input, "w-20")}
                  />
                ) : null}
              </div>
            );
          })}
          <Button
            variant="ghost-muted"
            size="xs"
            className="self-start"
            onClick={() =>
              patch({
                tests: [
                  ...applicant.tests,
                  { name: "IELTS", status: "planned", date: "", score: "" },
                ],
              })
            }
          >
            Add a test
          </Button>
        </div>
      </Row>
      <Row label="Other">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Chip on={applicant.moi} onClick={() => patch({ moi: !applicant.moi })}>
            Medium-of-instruction certificate
          </Chip>
          <Chip
            on={applicant.dependents}
            onClick={() => patch({ dependents: !applicant.dependents })}
          >
            Moving with dependents
          </Chip>
          <label className="flex items-center gap-1.5">
            fee budget $
            <input
              type="number"
              min="0"
              value={applicant.feeBudgetUsd ?? ""}
              onChange={(e) => patch({ feeBudgetUsd: num(e.target.value) })}
              aria-label="Fee budget"
              className={cn(input, "w-20 text-foreground")}
            />
          </label>
          <label className="flex items-center gap-1.5">
            min stipend $
            <input
              type="number"
              min="0"
              value={applicant.minStipendUsd ?? ""}
              onChange={(e) => patch({ minStipendUsd: num(e.target.value) })}
              aria-label="Minimum stipend"
              className={cn(input, "w-24 text-foreground")}
            />
          </label>
        </div>
      </Row>
    </div>
  );
}
