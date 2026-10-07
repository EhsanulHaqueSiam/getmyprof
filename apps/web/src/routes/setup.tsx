import type { Applicant, DetailLevel, HuntPrefs, ProfileFact } from "@gradcode/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckIcon, FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip, Row } from "~/components/FormParts";
import { EligibilityFields } from "~/components/EligibilityFields";
import { BudgetStep, HuntStep, LOOP_NAMES } from "~/components/SetupSteps";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { toBase64 } from "~/lib/files";
import { TregSettings } from "~/components/TregSettings";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/setup")({ component: Setup });

const STEPS = ["Connect", "You", "Your hunt", "Detail and budget"] as const;
const DEFAULT_PREFS: HuntPrefs = {
  degrees: ["phd", "ms_phd"],
  intake: "Fall 2027",
  fallbackIntake: "Spring 2028",
  places: ["USA"],
  fields: ["NLP", "LLMs"],
  adjacent: ["clinical NLP"],
  fundingFloor: "full",
  preferTestWaivers: true,
  sweep: { reach: 3, match: 3, safety: 3 },
  priorities: ["money", "recruiting", "topic", "deadline", "rank"],
  followUpDays: [7, 14],
};

function Setup() {
  const app = useStore((s) => s.app);
  const loadApp = useStore((s) => s.loadApp);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<HuntPrefs>(app?.hunt?.prefs ?? DEFAULT_PREFS);
  const [facts, setFacts] = useState<ProfileFact[]>(app?.facts ?? []);
  const [applicant, setApplicant] = useState<Applicant | null>(app?.applicant ?? null);
  const [cvText, setCvText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [profileSource, setProfileSource] = useState<"app" | "hq">("app");
  const [gradhunt, setGradhunt] = useState(false);
  const [detail, setDetail] = useState<DetailLevel>("std");
  const [budget, setBudget] = useState({
    perThread: 0.5,
    perLoopRun: 0.5,
    perDay: 2,
    askOver: 0.01,
  });
  const [loops, setLoops] = useState<string[]>(LOOP_NAMES);

  useEffect(() => {
    if (!app) return;
    setProfileSource(app.settings.profileSource);
    setGradhunt(app.settings.gradhunt);
    setDetail(app.settings.detail);
    setBudget(app.settings.budget);
    if (app.hunt) setPrefs(app.hunt.prefs);
    setApplicant((a) => a ?? app.applicant);
    if (app.settings.profileSource === "app") setFacts(app.facts);
  }, [app]);

  const set = <K extends keyof HuntPrefs>(k: K, v: HuntPrefs[K]) =>
    setPrefs((p) => ({ ...p, [k]: v }));
  const move = (i: number, d: -1 | 1) => {
    const next = prefs.priorities.slice();
    const [x] = next.splice(i, 1);
    if (x) next.splice(i + d, 0, x);
    set("priorities", next);
  };

  async function readCv() {
    setReading(true);
    setError("");
    try {
      const extracted = await call("facts.extract", {
        text: cvText,
        // Links pasted with the CV (site, Scholar, GitHub, ORCID, LinkedIn) are fetched and cross-checked.
        links: [...new Set(cvText.match(/https?:\/\/[^\s)>\]]+/g) ?? [])].slice(0, 8),
        ...(file ? { pdfBase64: await toBase64(file) } : {}),
      });
      setFacts((f) => [...f.filter((x) => x.confirmed), ...extracted]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  }

  async function finish() {
    await call("hunt.save", {
      name: `${prefs.intake} · ${prefs.degrees.includes("phd") ? "funded PhD" : "funded degree"}`,
      prefs,
    });
    if (profileSource === "app") await call("facts.save", { facts });
    if (applicant) await call("applicant.save", applicant);
    await call("settings.update", {
      profileSource,
      gradhunt,
      detail,
      budget,
      setupDone: true,
    });
    const saved = await call("loops.list", {});
    for (const loop of saved.filter((x) => !loops.includes(x.name)))
      await call("loops.save", {
        id: loop.id,
        name: loop.name,
        instructions: loop.instructions,
        schedule: loop.schedule,
        budgetUsd: loop.budgetUsd,
        enabled: false,
      });
    await loadApp();
    void navigate({ to: "/" });
  }

  const hqFacts = profileSource === "hq" ? (app?.facts ?? []) : [];

  return (
    <div className="grid h-dvh grid-cols-[230px_minmax(0,1fr)]">
      <nav className="flex flex-col gap-0.5 border-r px-2.5 py-3.5">
        <div className="px-2.5 pb-3 font-semibold text-sm">gradcode</div>
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            aria-label={`Step ${i + 1}: ${s}`}
            className={cn(
              "flex h-8.5 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors",
              i === step
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-4.5 items-center justify-center rounded-full border font-mono text-2xs",
                i < step
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground",
              )}
            >
              {i < step ? <CheckIcon className="size-3" /> : i + 1}
            </span>
            {s}
          </button>
        ))}
      </nav>
      <section className="overflow-y-auto">
        <div key={step} className="max-w-[820px] animate-fade-up px-7 py-6">
          {step === 0 ? (
            <>
              <h1 className="font-semibold text-lg tracking-tight">Connect</h1>
              <p className="mt-0.5 mb-3 text-muted-foreground text-xs">
                gradcode runs Claude Code on this machine with your own login. Nothing goes through
                a gradcode server.
              </p>
              <Row label="Agent">
                <span className="text-success-foreground">●</span> Claude Code{" "}
                <span className="text-muted-foreground text-xs">
                  · your subscription pays for the thinking
                </span>
              </Row>
              <Row label="Runs on">
                {app?.host ?? "this machine"}{" "}
                <span className="text-muted-foreground text-xs">
                  · pick a machine that stays on, so loops run while you sleep
                </span>
              </Row>
              <Row label="Free sources">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "NSF awards",
                    "NIH RePORTER",
                    "OpenAlex",
                    "web search",
                    "faculty and lab pages",
                  ].map((s) => (
                    <Chip key={s} on onClick={() => undefined}>
                      {s}
                    </Chip>
                  ))}
                </div>
              </Row>
              <Row label="Paid lookups (treg)">
                <TregSettings />
              </Row>
              <Row label="Profile from">
                <div className="flex flex-wrap gap-1.5">
                  <Chip on={profileSource === "app"} onClick={() => setProfileSource("app")}>
                    This app
                  </Chip>
                  {app?.adapters.hq ? (
                    <Chip on={profileSource === "hq"} onClick={() => setProfileSource("hq")}>
                      Your hq vault
                    </Chip>
                  ) : null}
                </div>
              </Row>
              {app?.adapters.gradhunt ? (
                <Row label="gradhunt">
                  <Chip on={gradhunt} onClick={() => setGradhunt(!gradhunt)}>
                    Sync with ~/Personal/gradhunt
                  </Chip>
                </Row>
              ) : null}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h1 className="font-semibold text-lg tracking-tight">You</h1>
              <p className="mt-0.5 mb-3 text-muted-foreground text-xs">
                Confirm each fact. Drafts and fit scores only use the ones you confirm.
              </p>
              {applicant ? <EligibilityFields applicant={applicant} set={setApplicant} /> : null}
              {profileSource === "hq" ? (
                <div className="flex flex-col">
                  {hqFacts.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-2.5 border-b py-2 text-[12.5px] text-secondary-label"
                    >
                      <CheckIcon className="size-3.5 text-success-foreground" />
                      <span className="truncate">{f.text}</span>
                    </div>
                  ))}
                  <p className="mt-2 text-muted-foreground text-xs">
                    {hqFacts.length} facts from hq, read-only. Edit them in hq.
                  </p>
                </div>
              ) : (
                <>
                  <label className="my-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-input px-4 py-3.5 text-muted-foreground text-xs transition-colors hover:text-foreground">
                    <FileTextIcon className="size-4" />
                    <span className="text-foreground">
                      {file ? file.name : "Choose your CV (PDF)"}
                    </span>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <textarea
                    value={cvText}
                    onChange={(e) => setCvText(e.target.value)}
                    rows={3}
                    placeholder="Or paste your CV text, site, Scholar or LinkedIn"
                    aria-label="CV text"
                    className="w-full resize-none rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-placeholder"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => void readCv()}
                      disabled={reading || (!file && !cvText.trim())}
                    >
                      {reading ? "Reading" : "Read it"}
                    </Button>
                    {error ? (
                      <span className="text-destructive-foreground text-xs">{error}</span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-col">
                    {facts.map((f) => (
                      <label
                        key={f.id}
                        data-testid="fact"
                        className={cn(
                          "grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 border-b py-2 text-[12.5px]",
                          f.question ? "text-warning-foreground" : "text-secondary-label",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={f.confirmed}
                          onChange={() =>
                            setFacts((all) =>
                              all.map((x) =>
                                x.id === f.id ? { ...x, confirmed: !x.confirmed } : x,
                              ),
                            )
                          }
                          className="size-3.5 accent-foreground"
                        />
                        <span>{f.text}</span>
                        <span className="text-2xs text-muted-foreground">{f.source}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : null}

          {step === 2 ? <HuntStep prefs={prefs} set={set} move={move} /> : null}
          {step === 3 ? (
            <BudgetStep
              detail={detail}
              setDetail={setDetail}
              budget={budget}
              setBudget={setBudget}
              loops={loops}
              setLoops={setLoops}
            />
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            {step > 0 ? (
              <Button variant="ghost-muted" size="sm" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Continue
              </Button>
            ) : (
              <Button size="sm" onClick={() => void finish()}>
                Start hunting
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
