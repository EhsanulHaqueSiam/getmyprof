import { Scholarship } from "@getmyprof/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Choice, Table, Td } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { daysLeft, due, fitsMe } from "~/lib/vault";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

/** Asks the agent to look, in a new thread. Its finds wait in To file. */
function FindButton({ what, prompt }: { what: string; prompt: string }) {
  const navigate = useNavigate();
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={async () => {
        const t = await call("threads.create", { text: prompt, title: `Find ${what}` });
        void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
      }}
    >
      Find {what}
    </Button>
  );
}

const Deadline = ({ date }: { date: string | null }) =>
  date ? (
    <span className={cn(daysLeft(date) >= 0 && daysLeft(date) <= 30 && "text-warning-foreground")}>
      {date} · {due(date)}
    </span>
  ) : (
    <span className="text-placeholder">?</span>
  );

/** A row's name with its page one click away; the second line carries the details. */
const Title = ({ text, url }: { text: string; url: string }) => (
  <div className="flex items-center gap-1.5">
    <span className="truncate" title={text}>
      {text}
    </span>
    {url ? (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${text}`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <ExternalLinkIcon className="size-3" />
      </a>
    ) : null}
  </div>
);

const Detail = ({ text }: { text: string }) => (
  <div className="truncate font-normal text-muted-foreground text-xs" title={text}>
    {text}
  </div>
);

/** Scholarships, with a filter for the ones open to the applicant's citizenship and track. */
export function VaultScholarships() {
  const list = useStore((s) => s.vault)?.scholarships ?? [];
  const applicant = useStore((s) => s.app?.applicant);
  const degrees = useStore((s) => s.app?.hunt)?.prefs.degrees ?? [];
  const [mine, setMine] = useState(true);
  const shown = mine && applicant ? list.filter((s) => fitsMe(s, applicant, degrees)) : list;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-4 py-2">
        <h1 className="font-semibold text-sm">Scholarships</h1>
        <button
          type="button"
          aria-pressed={mine}
          onClick={() => setMine(!mine)}
          className={cn(
            "h-7 rounded-lg px-2.5 text-xs transition-colors",
            mine ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Fits me
        </button>
        <span className="mr-auto text-muted-foreground text-xs tabular-nums">
          {shown.length} of {list.length}
        </span>
        <FindButton
          what="scholarships"
          prompt="Find scholarships I qualify for: open to my citizenship, for the degrees I'm hunting, with a round I can still make. File each with propose_scholarship."
        />
      </header>
      <Table
        head={["Scholarship", "Open to", "Deadline", "Status"]}
        widths={["auto", "110px", "170px", "120px"]}
        empty={shown.length ? null : "None yet. Find scholarships, then file the ones that fit."}
        testId="scholarships"
      >
        {shown.map((s) => (
          <tr key={s.id} className="transition-colors hover:bg-secondary">
            <Td strong className="h-auto max-w-none py-1.5">
              <Title text={s.name} url={s.url} />
              <Detail
                text={[s.sponsor, `study in ${s.studyIn}`, s.amount].filter(Boolean).join(" · ")}
              />
            </Td>
            <Td muted>{s.citizenship.join(", ") || "any"}</Td>
            <Td>
              <Deadline date={s.deadline} />
            </Td>
            <Td>
              <Choice
                label={`Status of ${s.name}`}
                value={s.status}
                options={Scholarship.shape.status.options}
                onChange={(status) =>
                  void call("vault.save", { kind: "scholarship", value: { ...s, status } })
                }
              />
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

/** Programs to apply to: deadline, fee, English rules and funding, and a way into an application. */
export function VaultPrograms({ onOpenApplication }: { onOpenApplication: () => void }) {
  const programs = useStore((s) => s.vault)?.programs ?? [];
  const apps = useStore((s) => s.vault)?.applications ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-4 py-2">
        <h1 className="mr-auto font-semibold text-sm">Programs</h1>
        <FindButton
          what="programs"
          prompt="Find programs that fit my preferences at schools in my sheet: deadline for my intake, fee and waiver, English rules, and how admits are funded. File each with propose_program."
        />
      </header>
      <Table
        head={["Program", "Deadline", "Application"]}
        widths={["auto", "170px", "150px"]}
        empty={programs.length ? null : "None yet. Find programs, then file the ones that fit."}
        testId="programs"
      >
        {programs.map((p) => {
          const app = apps.find((a) => a.programId === p.id);
          return (
            <tr key={p.id} className="transition-colors hover:bg-secondary">
              <Td strong className="h-auto max-w-none py-1.5">
                <Title text={`${p.university} · ${p.name}`} url={p.url} />
                <Detail
                  text={[
                    p.funding,
                    p.fee && `fee ${p.fee}`,
                    p.waiver && `waiver ${p.waiver}`,
                    p.english,
                    p.limit && `statement ${p.limit}`,
                    // Whether this applicant can be admitted and funded here, as the agent read it.
                    p.eligibility && (p.eligibility === "ok" ? "eligible" : p.eligibility),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </Td>
              <Td>
                <Deadline date={p.deadline} />
              </Td>
              <Td>
                <Button
                  size="xs"
                  variant={app ? "ghost-muted" : "outline"}
                  onClick={async () => {
                    if (!app) await call("applications.start", { programId: p.id });
                    onOpenApplication();
                  }}
                >
                  {app ? app.status.replace("-", " ") : "Start application"}
                </Button>
              </Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
