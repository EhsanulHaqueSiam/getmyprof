import type { DetailLevel, HuntPrefs, MethodOutput } from "@getmyprof/contracts";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CountryLines } from "~/components/CountryLines";
import { Chip, ListEditor, Row } from "~/components/FormParts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";

const PRIORITY_LABEL = {
  money: "Money that lasts into my first year",
  recruiting: "Taking students for my intake",
  topic: "Topic fit",
  deadline: "Nearest deadline",
  rank: "School rank",
} as const;
const SUGGESTED_PLACES = [
  "USA",
  "Canada",
  "UK",
  "Ireland",
  "Germany",
  "Netherlands",
  "Switzerland",
  "Sweden",
  "France",
  "Australia",
  "Japan",
  "South Korea",
  "Hong Kong",
  "Singapore",
];
const SUGGESTED_ADJACENT = [
  "clinical NLP",
  "computational social science",
  "education",
  "legal NLP",
  "digital humanities",
  "bioinformatics",
];
export const LOOP_NAMES = [
  "Nightly sweep",
  "Recruiting watch",
  "New awards",
  "Deadline watch",
  "Professor watch",
];

const FUNDING_FLOORS = ["full", "tuition"] as const satisfies HuntPrefs["fundingFloor"][];

type Budget = { perThread: number; perLoopRun: number; perDay: number; askOver: number };

/** First run, step 3: what the applicant is hunting for. */
/**
 * Fields next to the hunt's, ranked by funded PIs at the applicant's kept (or sheet) schools, with
 * citizen-only training grants apart. Add puts one in the adjacent domains.
 */
function BetterOddsList({ prefs, onAdd }: { prefs: HuntPrefs; onAdd: (field: string) => void }) {
  const [odds, setOdds] = useState<MethodOutput<"hunt.betterOdds"> | null>(null);
  const fieldsKey = prefs.fields.join("|");
  useEffect(() => {
    setOdds(null);
    const fields = fieldsKey.split("|").filter(Boolean);
    const t = setTimeout(
      () =>
        void call("hunt.betterOdds", { fields, intake: prefs.intake }).then(setOdds, () =>
          setOdds({ schools: [], core: 0, fields: [] }),
        ),
      600,
    );
    return () => clearTimeout(t);
  }, [fieldsKey, prefs.intake]);
  const note = "text-muted-foreground text-xs";
  if (!odds) return <span className={note}>Comparing fields at your schools</span>;
  if (!odds.schools.length || !odds.fields.length)
    return (
      <span className={note}>
        Keep schools on your shortlist to compare fields there, or start "Fields with better odds"
        from the home page.
      </span>
    );
  const most = Math.max(1, ...odds.fields.map((f) => f.fundedPis));
  return (
    <div className="flex flex-col gap-1.5">
      <span className={note}>
        Funded PIs at {odds.schools.join(", ")} past your intake; {odds.core} in your own fields.
      </span>
      {odds.fields.map((f) => {
        const added = prefs.adjacent.includes(f.field);
        return (
          <div key={f.field} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-48">{f.field}</span>
            <span
              className="h-1.5 rounded-sm bg-primary"
              style={{ width: `${Math.round((f.fundedPis / most) * 80) + 2}px` }}
            />
            <span className={note}>
              {f.fundedPis} funded PI{f.fundedPis === 1 ? "" : "s"}
              {f.usd ? `, $${(f.usd / 1e6).toFixed(1)}M` : ""}
              {f.citizenOnly ? ` · ${f.citizenOnly} training grants pay US citizens only` : ""}
            </span>
            <Button size="xs" variant="outline" disabled={added} onClick={() => onAdd(f.field)}>
              {added ? "Added" : "Add"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function HuntStep({
  prefs,
  set,
  move,
}: {
  prefs: HuntPrefs;
  set: <K extends keyof HuntPrefs>(k: K, v: HuntPrefs[K]) => void;
  move: (i: number, d: -1 | 1) => void;
}) {
  // Domains next to your fields, from OpenAlex; the fixed list only when it can't be reached.
  const [adjacent, setAdjacent] = useState<string[]>([]);
  const fieldsKey = prefs.fields.join("|");
  useEffect(() => {
    const t = setTimeout(
      () =>
        void call("hunt.adjacent", { fields: fieldsKey.split("|").filter(Boolean) }).then(
          setAdjacent,
        ),
      400,
    );
    return () => clearTimeout(t);
  }, [fieldsKey]);
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
          <Input
            className="w-32"
            value={prefs.intake}
            onChange={(e) => set("intake", e.target.value)}
            aria-label="Intake"
          />
          <span className="text-muted-foreground text-xs">then</span>
          <Input
            className="w-32"
            value={prefs.fallbackIntake}
            onChange={(e) => set("fallbackIntake", e.target.value)}
            aria-label="Fallback intake"
          />
        </div>
      </Row>
      <Row label="Places">
        <ListEditor
          values={prefs.places}
          suggested={SUGGESTED_PLACES}
          onChange={(v) => set("places", v)}
        />
        <div className="mt-2 space-y-1">
          <CountryLines places={prefs.places} />
        </div>
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
          suggested={adjacent.length ? adjacent : SUGGESTED_ADJACENT}
          onChange={(v) => set("adjacent", v)}
        />
        <span className="mt-1.5 block text-muted-foreground text-xs">
          These labs need your skills and get fewer applicants.
        </span>
      </Row>
      <Row label="Better odds">
        <BetterOddsList
          prefs={prefs}
          onAdd={(field) => set("adjacent", [...prefs.adjacent, field])}
        />
      </Row>
      <Row label="Funding floor">
        <ToggleGroup
          size="xs"
          value={[prefs.fundingFloor]}
          onValueChange={(v) => {
            const next = FUNDING_FLOORS.find((f) => f === v[0]);
            if (next) set("fundingFloor", next);
          }}
          aria-label="Funding floor"
        >
          <Toggle value="full">Full: tuition and stipend, every year</Toggle>
          <Toggle value="tuition">Tuition only is fine</Toggle>
        </ToggleGroup>
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
      <Row label="Each sweep">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          {(["reach", "match", "safety"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <Input
                type="number"
                min="0"
                className="w-14"
                value={prefs.sweep[k]}
                onChange={(e) => set("sweep", { ...prefs.sweep, [k]: Number(e.target.value) })}
                aria-label={`${k} schools per sweep`}
              />
              {k}
            </label>
          ))}
          <span>schools per sweep</span>
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
              ["brief", "Brief", "fit, money, taking students, email", "6 columns · cheapest"],
              [
                "std",
                "Standard",
                "adds what they work on and look for, how long the money lasts, contact rule",
                "12 columns",
              ],
              [
                "deep",
                "Deep",
                "adds recent work, the way in, why they fit you and every source",
                "16 columns · most calls",
              ],
            ] as const
          ).map(([id, title, body, note]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDetail(id)}
              aria-pressed={detail === id}
              className={cn(
                "flex flex-col items-start rounded-xl border px-3 py-2.5 text-left text-xs transition-colors",
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
              <Input
                type="number"
                step="0.01"
                min="0"
                className="w-16"
                value={budget[k]}
                onChange={(e) => setBudget((b) => ({ ...b, [k]: Number(e.target.value) }))}
                aria-label={label}
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
