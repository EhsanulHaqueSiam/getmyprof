import type { DetailLevel, HuntPrefs } from "@gradcode/contracts";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Chip, ListEditor, Row } from "~/components/FormParts";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const PRIORITY_LABEL = {
  money: "Money that lasts into my first year",
  recruiting: "Taking students for my intake",
  topic: "Topic fit",
  deadline: "Nearest deadline",
  rank: "School rank",
} as const;
const SUGGESTED_PLACES = ["USA", "Canada", "Germany", "UK", "Switzerland", "Ireland", "Australia"];
const SUGGESTED_ADJACENT = [
  "clinical NLP",
  "computational social science",
  "education",
  "legal NLP",
  "digital humanities",
  "bioinformatics",
];
export const LOOP_NAMES = ["Nightly sweep", "Recruiting watch", "New awards", "Deadline watch"];

type Budget = { perThread: number; perLoopRun: number; perDay: number; askOver: number };

/** First run, step 3: what the applicant is hunting for. */
export function HuntStep({
  prefs,
  set,
  move,
}: {
  prefs: HuntPrefs;
  set: <K extends keyof HuntPrefs>(k: K, v: HuntPrefs[K]) => void;
  move: (i: number, d: -1 | 1) => void;
}) {
  return (
    <>
      <h1 className="font-semibold text-lg tracking-tight">Your hunt</h1>
      <p className="mt-0.5 mb-3 text-muted-foreground text-xs">
        Every turn and every loop reads this. Change it any time.
      </p>
      <Row label="Degree">
        <div className="flex flex-wrap gap-1.5">
          {(["phd", "ms_phd", "funded_ms"] as const).map((d) => (
            <Chip
              key={d}
              on={prefs.degrees.includes(d)}
              onClick={() =>
                set(
                  "degrees",
                  prefs.degrees.includes(d)
                    ? prefs.degrees.filter((x) => x !== d)
                    : [...prefs.degrees, d],
                )
              }
            >
              {
                {
                  phd: "PhD, funded",
                  ms_phd: "MS + PhD, funded",
                  funded_ms: "Fully funded MS",
                }[d]
              }
            </Chip>
          ))}
        </div>
      </Row>
      <Row label="Intake">
        <div className="flex items-center gap-2">
          <input
            value={prefs.intake}
            onChange={(e) => set("intake", e.target.value)}
            aria-label="Intake"
            className="h-7 w-32 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
          />
          <span className="text-muted-foreground text-xs">then</span>
          <input
            value={prefs.fallbackIntake}
            onChange={(e) => set("fallbackIntake", e.target.value)}
            aria-label="Fallback intake"
            className="h-7 w-32 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
          />
        </div>
      </Row>
      <Row label="Places">
        <ListEditor
          values={prefs.places}
          suggested={SUGGESTED_PLACES}
          onChange={(v) => set("places", v)}
        />
      </Row>
      <Row label="Fields">
        <ListEditor
          values={prefs.fields}
          suggested={[
            "NLP",
            "LLMs",
            "low-resource NLP",
            "retrieval and RAG",
            "efficient LLMs",
            "LLM safety",
          ]}
          onChange={(v) => set("fields", v)}
        />
      </Row>
      <Row label="Adjacent domains">
        <ListEditor
          values={prefs.adjacent}
          suggested={SUGGESTED_ADJACENT}
          onChange={(v) => set("adjacent", v)}
        />
        <span className="mt-1.5 block text-muted-foreground text-xs">
          These labs need your skills and get fewer applicants.
        </span>
      </Row>
      <Row label="Funding floor">
        <div className="flex flex-wrap gap-1.5">
          <Chip on={prefs.fundingFloor === "full"} onClick={() => set("fundingFloor", "full")}>
            Full: tuition and stipend, every year
          </Chip>
          <Chip
            on={prefs.fundingFloor === "tuition"}
            onClick={() => set("fundingFloor", "tuition")}
          >
            Tuition only is fine
          </Chip>
        </div>
      </Row>
      <Row label="English tests">
        <Chip
          on={prefs.preferTestWaivers}
          onClick={() => set("preferTestWaivers", !prefs.preferTestWaivers)}
        >
          Prefer programs that accept a medium-of-instruction certificate or waive tests
        </Chip>
      </Row>
      <Row label="What matters">
        <div className="flex flex-col">
          {prefs.priorities.map((p, i) => (
            <div
              key={p}
              className="grid h-8 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 border-b text-[12.5px] text-secondary-label"
            >
              <span className="font-mono text-muted-foreground text-xs">{i + 1}</span>
              {PRIORITY_LABEL[p]}
              <span className="flex gap-0.5">
                <Button
                  variant="ghost-muted"
                  size="icon-micro"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost-muted"
                  size="icon-micro"
                  aria-label="Move down"
                  disabled={i === prefs.priorities.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDownIcon />
                </Button>
              </span>
            </div>
          ))}
        </div>
      </Row>
    </>
  );
}

/** First run, step 4: how deep to dig, what to spend, which loops to start. */
export function BudgetStep(props: {
  detail: DetailLevel;
  setDetail: (d: DetailLevel) => void;
  budget: Budget;
  setBudget: (f: (b: Budget) => Budget) => void;
  loops: string[];
  setLoops: (l: string[]) => void;
}) {
  const { detail, setDetail, budget, setBudget, loops, setLoops } = props;
  return (
    <>
      <h1 className="font-semibold text-lg tracking-tight">Detail and budget</h1>
      <p className="mt-0.5 mb-3 text-muted-foreground text-xs">
        How much to dig per professor, and what you'll spend.
      </p>
      <Row label="Detail">
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              ["brief", "Brief", "fit, money, taking students, email", "~5 columns · cheapest"],
              [
                "std",
                "Standard",
                "adds how long the money lasts, contact rule, stage",
                "~8 columns",
              ],
              [
                "deep",
                "Deep",
                "adds why they fit you and every source",
                "~10 columns · most calls",
              ],
            ] as const
          ).map(([id, title, body, note]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDetail(id)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left text-xs transition-colors",
                detail === id
                  ? "border-input bg-popover text-foreground"
                  : "text-secondary-label hover:border-input",
              )}
            >
              <span className="mb-1 block font-semibold text-[12.5px] text-foreground">
                {title}
              </span>
              {body}
              <span className="mt-1 block font-mono text-2xs text-muted-foreground">{note}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row label="Budget">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          {(
            [
              ["perThread", "a thread"],
              ["perLoopRun", "a loop run"],
              ["perDay", "a day"],
              ["askOver", "ask above"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 text-muted-foreground">
              $
              <input
                type="number"
                step="0.01"
                min="0"
                value={budget[k]}
                onChange={(e) => setBudget((b) => ({ ...b, [k]: Number(e.target.value) }))}
                aria-label={label}
                className="h-7 w-16 rounded-lg border border-input bg-transparent px-2 text-foreground outline-none"
              />
              {label}
            </label>
          ))}
        </div>
      </Row>
      <Row label="Start these loops">
        <div className="flex flex-wrap gap-1.5">
          {LOOP_NAMES.map((l) => (
            <Chip
              key={l}
              on={loops.includes(l)}
              onClick={() =>
                setLoops(loops.includes(l) ? loops.filter((x) => x !== l) : [...loops, l])
              }
            >
              {l}
            </Chip>
          ))}
        </div>
      </Row>
    </>
  );
}
