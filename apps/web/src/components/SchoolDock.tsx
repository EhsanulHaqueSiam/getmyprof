import { type School, SchoolTier } from "@getmyprof/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  AwardIcon,
  CheckIcon,
  GraduationCapIcon,
  PenLineIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Choice } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { plural } from "~/lib/format";
import { type SchoolRow, TIER_TONE } from "~/lib/schools";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";

const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? url;
const save = (s: School, change: Partial<School>) =>
  void call("vault.save", { kind: "school", value: { ...s, ...change } });

/** One action in the dock: an icon, what it does, and what it costs. */
function Action({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-8.5 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] transition-[background-color,scale] hover:bg-accent active:scale-[0.99] [&>svg]:size-3.5 [&>svg]:text-muted-foreground"
    >
      {icon}
      {label}
      <span className="font-mono text-2xs text-muted-foreground">free</span>
    </button>
  );
}

/**
 * The Schools page's dock: actions on the selected schools (each starts a thread scoped to
 * them), the agent's suggestions to keep or drop, and why the focused school sits in its tier.
 */
export function SchoolDock({
  picked,
  suggested,
  focus,
  onFocus,
}: {
  picked: SchoolRow[];
  suggested: School[];
  focus: School | null;
  onFocus: (id: string) => void;
}) {
  const navigate = useNavigate();
  /** Starts a thread about the picked schools; their sheet rows ride along for the agent. */
  const start = async (title: string, text: string) => {
    const t = await call("threads.create", {
      text,
      title,
      scope: picked.map((r) => ({ kind: "school" as const, name: r.school.name })),
    });
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  };
  const names = picked.map((r) => r.school.name).join(", ");
  const toDraft = picked.flatMap((r) => r.professors.map((p) => p.key));

  return (
    <aside className="flex min-w-0 flex-col border-l" data-testid="schools-dock">
      <div className="flex h-12 items-center gap-2 px-4 text-sm">
        <span className="font-semibold">Agent</span>
        <span className="flex items-center gap-1 text-muted-foreground text-xs">
          <GraduationCapIcon className="size-3.5" /> {picked.length} selected
        </span>
      </div>
      <div className="px-4 pt-1 pb-1 text-muted-foreground text-xs">School actions</div>
      <div
        className={cn(
          "flex flex-col px-1.5",
          picked.length === 0 && "pointer-events-none opacity-40",
        )}
      >
        <Action
          icon={<SearchIcon />}
          label="Find professors here"
          onClick={() =>
            void start(
              `Professors at ${plural(picked.length, "school")}`,
              `Find professors at ${names} whose current work fits my fields and who can fund a student for my intake.`,
            )
          }
        />
        <Action
          icon={<GraduationCapIcon />}
          label="Check programs (deadline, fee, English)"
          onClick={() =>
            void start(
              `Programs at ${plural(picked.length, "school")}`,
              `Find programs at ${names}: deadline for my intake, fee and waiver, English rules, and how admits are funded.`,
            )
          }
        />
        <Action
          icon={<AwardIcon />}
          label="Scholarships that pay here"
          onClick={() =>
            void start(
              "Scholarships for my schools",
              `Find scholarships that pay for study in ${[...new Set(picked.map((r) => r.school.country))].join(", ")}: open to my citizenship, for the degrees I'm hunting, with a round I can still make.`,
            )
          }
        />
        <Action
          icon={<PenLineIcon />}
          label={`Draft first emails · ${plural(toDraft.length, "professor")}`}
          onClick={async () => {
            if (!toDraft.length) return;
            const t = await call("threads.startRowAction", { op: "draft", keys: toDraft });
            void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
          }}
        />
      </div>

      {suggested.length ? (
        <div className="mt-3 border-t px-4 pt-2.5">
          <div className="flex items-center gap-2 pb-1 text-muted-foreground text-xs">
            Suggested · {suggested.length}
            <span className="ml-auto flex gap-1">
              <Button
                variant="outline"
                size="xs"
                onClick={() => suggested.forEach((s) => save(s, { status: "kept" }))}
              >
                <CheckIcon /> Keep all
              </Button>
              <Button
                variant="ghost-muted"
                size="xs"
                onClick={() => suggested.forEach((s) => save(s, { status: "dropped" }))}
              >
                Drop all
              </Button>
            </span>
          </div>
          {suggested.map((s) => (
            <div
              key={s.id}
              data-testid="school-suggestion"
              className="flex h-8 items-center gap-2 border-b text-[12.5px] last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onFocus(s.id)}
                className="min-w-0 flex-1 truncate text-left text-secondary-label hover:text-foreground"
              >
                {s.name}
              </button>
              <span className={cn("text-xs", TIER_TONE[s.tier])}>{s.tier}</span>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label={`Keep ${s.name}`}
                onClick={() => save(s, { status: "kept" })}
              >
                <CheckIcon />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label={`Drop ${s.name}`}
                onClick={() => save(s, { status: "dropped" })}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {focus ? (
        <div className="mt-3 border-t px-4 pt-2.5 pb-4 text-[12.5px]" data-testid="school-focus">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{focus.name}</span>
            <Choice
              label={`Tier of ${focus.name}`}
              value={focus.tier}
              options={SchoolTier.options}
              onChange={(t) => save(focus, { tier: t })}
            />
          </div>
          <p className="mt-1.5 text-secondary-label">{focus.why || "No reason given."}</p>
          <div className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground text-xs">
            {focus.sources.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="hover:underline">
                {host(u)}
              </a>
            ))}
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {focus.status !== "kept" ? (
              <Button variant="outline" size="xs" onClick={() => save(focus, { status: "kept" })}>
                <CheckIcon /> Keep
              </Button>
            ) : null}
            {focus.status !== "dropped" ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => save(focus, { status: "dropped" })}
              >
                <XIcon /> Drop
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
