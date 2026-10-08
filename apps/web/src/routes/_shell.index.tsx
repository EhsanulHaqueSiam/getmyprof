import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  GraduationCapIcon,
  LandmarkIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import type { ScopeItem } from "@gradcode/contracts";
import { type ReactNode, useEffect } from "react";
import { Composer } from "~/components/Composer";
import { Kbd } from "~/components/ui/kbd";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

// "Ask about Lybarger" lands here with ?about=<record key>&name=<name>.
export const Route = createFileRoute("/_shell/")({
  component: NewThread,
  validateSearch: (s: Record<string, unknown>): { about?: string; name?: string } => ({
    ...(typeof s.about === "string" ? { about: s.about } : {}),
    ...(typeof s.name === "string" ? { name: s.name } : {}),
  }),
});

const STARTERS: { icon: ReactNode; title: string; detail: string; prompt: string }[] = [
  {
    icon: <UsersIcon />,
    title: "Find professors",
    detail: "niche and schools, verified rows with sources",
    prompt:
      "Find professors in my fields at schools that fit my preferences, who can fund a student for my intake.",
  },
  {
    icon: <LandmarkIcon />,
    title: "Follow the money",
    detail: "NSF and NIH awards, then the PIs who can pay",
    prompt:
      "Search NSF and NIH for active awards in my fields that last past my intake, and propose the PIs who aren't in my sheet yet.",
  },
  {
    icon: <UserIcon />,
    title: "Vet a professor",
    detail: "taking students, funded, contact rule, fit",
    prompt:
      "Vet this professor: are they taking students for my intake, is their money active, and how do they want to be contacted? ",
  },
  {
    icon: <GraduationCapIcon />,
    title: "Check a program",
    detail: "deadline, fee, English, funding for internationals",
    prompt:
      "Check this program's deadline, fee, English test rules and funding for international students: ",
  },
  {
    icon: <ChevronRightIcon />,
    title: "Next school",
    detail: "the next school that fits, CS and adjacent departments",
    prompt:
      "Pick the next school that fits my preferences and isn't in my sheet, and sweep it for professors who can fund me.",
  },
];

const typingIn = (t: EventTarget | null) =>
  t instanceof HTMLElement && t.closest("input, textarea, [contenteditable]") !== null;

function NewThread() {
  const navigate = useNavigate();
  const hunt = useStore((s) => s.app?.hunt);
  const { about, name } = Route.useSearch();
  const asking: ScopeItem[] = about && name ? [{ kind: "professor", key: about, name }] : [];
  const start = async (
    text: string,
    title?: string,
    attachments: string[] = [],
    scope: ScopeItem[] = [],
  ) => {
    const t = await call("threads.create", {
      text,
      ...(title ? { title } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(scope.length ? { scope } : {}),
    });
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  };

  // 1 to 5 start a starter; any other key starts typing in the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const starter = STARTERS[Number(e.key) - 1];
      if (/^[1-5]$/.test(e.key) && starter) {
        e.preventDefault();
        void start(starter.prompt, starter.title);
      } else if (e.key.length === 1)
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center px-6">
      <div className="mx-auto w-full max-w-[46rem]">
        <h1 className="font-semibold text-xl tracking-tight">What should we find?</h1>
        <p className="mt-0.5 text-muted-foreground text-sm">
          {hunt ? `${hunt.name}. ` : ""}Runs on this machine; you can close the window.
        </p>
        <div className="my-5 flex flex-col">
          {STARTERS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => void start(s.prompt, s.title)}
              className="grid h-10 grid-cols-[20px_170px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 text-left text-sm transition-colors hover:bg-accent [&>svg]:size-4 [&>svg]:text-muted-foreground"
            >
              {s.icon}
              <span>{s.title}</span>
              <span className="truncate text-muted-foreground">{s.detail}</span>
              <Kbd className="bg-transparent">{i + 1}</Kbd>
            </button>
          ))}
        </div>
        <Composer
          key={about ?? "new"}
          // Asking about someone starts typing at once; otherwise 1 to 5 pick a starter first.
          autoFocus={asking.length > 0}
          mentions={asking}
          ask={asking.length > 0}
          placeholder={
            name
              ? `Ask about ${name}.`
              : "Describe what to find. @ a school or professor to scope it."
          }
          onSend={(text, _delivery, attachments, scope) =>
            void start(text, undefined, attachments, scope)
          }
        />
      </div>
    </div>
  );
}
