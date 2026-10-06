import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  GraduationCapIcon,
  LandmarkIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Composer } from "~/components/Composer";
import { Kbd } from "~/components/ui/kbd";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/")({ component: NewThread });

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

function NewThread() {
  const navigate = useNavigate();
  const hunt = useStore((s) => s.app?.hunt);
  const start = async (text: string, title?: string) => {
    const t = await call("threads.create", { text, ...(title ? { title } : {}) });
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  };
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
          autoFocus
          placeholder="Describe what to find."
          onSend={(text) => void start(text)}
        />
      </div>
    </div>
  );
}
