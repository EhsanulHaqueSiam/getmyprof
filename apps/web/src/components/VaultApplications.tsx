import { type Application, AppStatus, type Professor, type Program } from "@gradcode/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { Chip } from "~/components/FormParts";
import { Interviews } from "~/components/Interviews";
import { Choice } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { daysLeft, due } from "~/lib/vault";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const WAIVER = ["none", "requested", "granted", "denied"] as const;
const REC_STATUS = ["to-ask", "asked", "agreed", "submitted"] as const;
const school = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const save = (value: Application) => void call("vault.save", { kind: "application", value });

/** The agent drafts a short note in a new thread; it lands in Vault > Writing. */
const writeNote = async (about: string) => {
  const t = await call("writing.start", {
    kind: "note",
    programId: null,
    scholarshipId: null,
    basedOn: null,
    about,
  });
  return t.id;
};

function Recommenders({ app, program }: { app: Application; program: Program | undefined }) {
  const navigate = useNavigate();
  const open = (about: string) =>
    void writeNote(about).then((threadId) =>
      navigate({ to: "/t/$threadId", params: { threadId } }),
    );
  const target = program ? `${program.university} ${program.name}` : "this program";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <div className="flex flex-col gap-1">
      {app.recommenders.map((r, i) => (
        <div
          key={`${r.email}-${r.name}`}
          data-testid="recommender"
          className="grid grid-cols-[9rem_11rem_auto_auto_auto_auto] items-center gap-2"
        >
          <span className="truncate text-foreground">{r.name}</span>
          <span className="truncate text-muted-foreground">{r.email}</span>
          <Choice
            label={`Status of ${r.name}`}
            value={r.status}
            options={REC_STATUS}
            onChange={(status) =>
              save({
                ...app,
                recommenders: app.recommenders.map((x, j) => (j === i ? { ...x, status } : x)),
              })
            }
          />
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() =>
              open(
                `Reminder to ${r.name} (${r.email || "no email"}): their recommendation letter for ${target} is due ${program?.deadline ?? "soon"}`,
              )
            }
          >
            Reminder
          </Button>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() =>
              open(
                `Thank-you to ${r.name} (${r.email || "no email"}) for their letter for ${target}`,
              )
            }
          >
            Thank-you
          </Button>
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Remove ${r.name}`}
            onClick={() =>
              save({ ...app, recommenders: app.recommenders.filter((_, j) => j !== i) })
            }
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          save({ ...app, recommenders: [...app.recommenders, { name, email, status: "to-ask" }] });
          setName("");
          setEmail("");
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Recommender"
          aria-label="Recommender name"
          className="h-6.5 w-36 rounded-md border border-input bg-transparent px-2 outline-none placeholder:text-placeholder"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email"
          aria-label="Recommender email"
          className="h-6.5 w-44 rounded-md border border-input bg-transparent px-2 outline-none placeholder:text-placeholder"
        />
        <Button type="submit" size="icon-xs" variant="ghost-muted" aria-label="Add recommender">
          <PlusIcon />
        </Button>
      </form>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3 py-1">
      <span className="pt-0.5 text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ApplicationView({
  app,
  program,
  people,
}: {
  app: Application;
  program: Program | undefined;
  people: Professor[];
}) {
  const docs = useStore((s) => s.vault)?.documents ?? [];
  const here = people.filter((p) => program && school(p.university) === school(program.university));
  const left = app.documents.filter((d) => !d.done).length;
  return (
    <section className="border-b px-4 py-3 text-xs" data-testid="application">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap">
        <h2 className="font-semibold text-sm">
          {program ? `${program.university} · ${program.name}` : "Program removed"}
        </h2>
        {program?.deadline ? (
          <span
            className={cn(
              "text-muted-foreground",
              daysLeft(program.deadline) <= 14 &&
                daysLeft(program.deadline) >= 0 &&
                "text-warning-foreground",
            )}
          >
            due {program.deadline} · {due(program.deadline)}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          status
          <Choice
            label="Application status"
            value={app.status}
            options={AppStatus.options}
            onChange={(status) => save({ ...app, status })}
          />
          fee waiver
          <Choice
            label="Fee waiver"
            value={app.waiver}
            options={WAIVER}
            onChange={(waiver) => save({ ...app, waiver })}
          />
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Remove application"
            onClick={() => void call("vault.remove", { kind: "application", id: app.id })}
          >
            <Trash2Icon />
          </Button>
        </span>
      </div>
      <Row label={`Checklist · ${left} left`}>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {app.documents.map((d, i) => {
            const doc = docs.find((x) => x.id === d.docId);
            return (
              <label key={d.name} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-foreground"
                  checked={d.done}
                  onChange={() =>
                    save({
                      ...app,
                      documents: app.documents.map((x, j) =>
                        j === i ? { ...x, done: !x.done } : x,
                      ),
                    })
                  }
                />
                <span className={d.done ? "text-muted-foreground line-through" : "text-foreground"}>
                  {d.name}
                </span>
                {doc ? (
                  <a
                    href={`/api/files/${doc.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground underline decoration-muted-foreground underline-offset-2 hover:text-foreground"
                  >
                    {doc.name}
                  </a>
                ) : null}
              </label>
            );
          })}
        </div>
      </Row>
      <Row label="Recommenders">
        <Recommenders app={app} program={program} />
      </Row>
      <Row label="Portal">
        <div className="flex items-center gap-2">
          {app.portal ? (
            <a
              href={app.portal}
              target="_blank"
              rel="noreferrer"
              className="max-w-xs truncate text-info-foreground hover:underline"
            >
              {app.portal}
            </a>
          ) : null}
          <input
            defaultValue={app.portalStatus}
            placeholder="portal status, e.g. 2 of 3 letters in"
            aria-label="Portal status"
            onBlur={(e) =>
              e.target.value !== app.portalStatus && save({ ...app, portalStatus: e.target.value })
            }
            className="h-6.5 flex-1 rounded-md border border-input bg-transparent px-2 outline-none placeholder:text-placeholder"
          />
          <input
            defaultValue={app.applicationId}
            placeholder="application ID"
            aria-label="Application ID"
            onBlur={(e) =>
              e.target.value !== app.applicationId &&
              save({ ...app, applicationId: e.target.value.trim() })
            }
            className="h-6.5 w-36 rounded-md border border-input bg-transparent px-2 outline-none placeholder:text-placeholder"
          />
        </div>
      </Row>
      <Row label="Interviews">
        <Interviews app={app} program={program} named={here.map((p) => p.name)} />
      </Row>
      <Row label="Name in it">
        <div className="flex flex-wrap gap-1.5">
          {here.map((p) => (
            <Chip
              key={p.key}
              on={app.professors.includes(p.key)}
              onClick={() =>
                save({
                  ...app,
                  professors: app.professors.includes(p.key)
                    ? app.professors.filter((k) => k !== p.key)
                    : [...app.professors, p.key],
                })
              }
            >
              {p.name}
            </Chip>
          ))}
          {here.length === 0 ? (
            <span className="text-muted-foreground">
              No professors from this school in your sheet.
            </span>
          ) : null}
        </div>
        {app.status === "planning" || app.status === "in-progress" ? (
          <p className="mt-1 text-muted-foreground">
            On submit, the agent drafts an "I applied and named you" note to each one.
          </p>
        ) : null}
      </Row>
    </section>
  );
}

/** Every application: checklist, recommenders, portal, and who to name. */
export function VaultApplications() {
  const vault = useStore((s) => s.vault);
  const recordsVersion = useStore((s) => s.recordsVersion);
  const [people, setPeople] = useState<Professor[]>([]);
  useEffect(() => {
    void call("records.list", {}).then(setPeople);
  }, [recordsVersion]);
  const apps = vault?.applications ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <h1 className="font-semibold text-sm">Applications</h1>
        <span className="text-muted-foreground text-xs tabular-nums">{apps.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto border-t">
        {apps.map((a) => (
          <ApplicationView
            key={a.id}
            app={a}
            program={vault?.programs.find((p) => p.id === a.programId)}
            people={people}
          />
        ))}
        {apps.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted-foreground text-xs">
            No applications yet. Start one from Programs.
          </div>
        ) : null}
      </div>
    </div>
  );
}
