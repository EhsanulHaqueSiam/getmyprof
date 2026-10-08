import type { MethodOutput, Proposal } from "@gradcode/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { LinkIcon, MessageSquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Review } from "~/components/Review";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export type PanelTab = "review" | "professor" | "source";

const TIER = ["not checked", "1 clear", "2 strong", "3 indirect", "4 none"];
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");

/** One professor from the sheet, refetched when records change. */
function useRecord(key: string | null) {
  const recordsVersion = useStore((s) => s.recordsVersion);
  const [data, setData] = useState<MethodOutput<"records.get"> | null>(null);
  useEffect(() => {
    if (!key) return setData(null);
    call("records.get", { key }).then(setData, () => setData(null));
  }, [key, recordsVersion]);
  return data?.record.key === key ? data.record : null;
}

/** The professor this thread is looking at: what the sheet knows, and Ask about them. */
function ProfessorTab({
  recordKey,
  proposals,
}: {
  recordKey: string | null;
  proposals: Proposal[];
}) {
  const navigate = useNavigate();
  const p = useRecord(recordKey);
  // Someone not in the sheet yet: what the agent proposes, until Review accepts them.
  const added = proposals.find(
    (x) => x.recordKey === recordKey && x.kind === "add" && x.status === "pending",
  );
  if (!p && added)
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3" data-testid="professor-tab">
        <div className="font-semibold text-sm">{added.recordName}</div>
        <div className="text-muted-foreground text-xs">
          {added.university} · new, waiting in Review
        </div>
        <dl className="mt-3 grid grid-cols-[84px_minmax(0,1fr)] text-xs">
          {added.changes
            .filter((c) => c.field !== "name" && c.field !== "university")
            .map((c) => (
              <div key={c.field} className="contents">
                <dt className="border-b py-1.5 text-muted-foreground">{c.field}</dt>
                <dd className="border-b py-1.5 text-secondary-label">{c.to}</dd>
              </div>
            ))}
        </dl>
      </div>
    );
  if (!p)
    return (
      <div className="px-6 py-12 text-center text-muted-foreground text-xs">
        Pick a professor in Review, or @ one in the composer.
      </div>
    );
  const rows: [string, string][] = [
    ["Niche", p.niche],
    ["Money", [p.money, p.lasts && `lasts ${p.lasts}`].filter(Boolean).join(" · ")],
    ["Taking", p.taking],
    ["Contact", p.contact],
    ["Fits because", p.fitsBecause],
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3" data-testid="professor-tab">
      <div className="font-semibold text-sm">{p.name}</div>
      <div className="text-muted-foreground text-xs">
        {[p.department, p.university].filter(Boolean).join(" · ")}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
        <span>
          fit <b className="text-foreground">{p.fit}</b>
        </span>
        <span>{TIER[p.moneyTier]}</span>
        <span>email {p.emailCheck || "unchecked"}</span>
        <span>{p.stage}</span>
      </div>
      <dl className="mt-3 grid grid-cols-[84px_minmax(0,1fr)] text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="border-b py-1.5 text-muted-foreground">{k}</dt>
            <dd className="border-b py-1.5 text-secondary-label">
              {v || <span className="text-placeholder">not found</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-1.5">
        <Button
          size="xs"
          onClick={() => void navigate({ to: "/", search: { about: p.key, name: p.name } })}
        >
          <MessageSquareIcon /> Ask about {p.name.split(" ").at(-1)}
        </Button>
        <Button
          variant="ghost-muted"
          size="xs"
          render={<Link to="/professors/$key" params={{ key: p.key }} />}
        >
          Full page
        </Button>
      </div>
    </div>
  );
}

/** Where what the thread knows about the professor came from: the record's and the proposals' links. */
function SourceTab({ recordKey, proposals }: { recordKey: string | null; proposals: Proposal[] }) {
  const p = useRecord(recordKey);
  const links = [
    ...new Set([
      ...(p?.sources ?? []),
      ...proposals.filter((x) => x.recordKey === recordKey).flatMap((x) => x.sources),
    ]),
  ].filter((s) => /^https?:\/\//.test(s));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3" data-testid="source-tab">
      {p ? <div className="mb-2 text-muted-foreground text-xs">{p.name}</div> : null}
      {links.length ? (
        links.map((s) => (
          <a
            key={s}
            href={s}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 truncate py-1 text-secondary-label text-xs hover:text-foreground"
          >
            <LinkIcon className="size-3 shrink-0" />
            <span className="truncate">{host(s)}</span>
          </a>
        ))
      ) : (
        <div className="py-10 text-center text-muted-foreground text-xs">No sources recorded.</div>
      )}
    </div>
  );
}

/**
 * A thread's right panel: Review, the professor it is looking at, and where that came from.
 * `focus` is that professor: the one picked in Review, else the thread's first @ professor.
 */
export function ThreadPanel({
  selected,
  tab,
  onTab,
  focus,
  onFocus,
  proposals,
  drafts,
  finds,
  findsIn,
}: {
  /** The proposal j and k are on. */
  selected: string | null;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  focus: string | null;
  onFocus: (key: string) => void;
  proposals: Proposal[];
  drafts: number;
  finds: number;
  findsIn: "scholarships" | "programs" | undefined;
}) {
  const reviewCount = proposals.filter((p) => p.status === "pending").length;
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1 px-2 text-xs" role="tablist">
        {(["review", "professor", "source"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTab(t)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg px-2.5 capitalize transition-colors",
              tab === t
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {t === "review" ? (
              <span className="text-info-foreground tabular-nums">{reviewCount}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === "review" ? (
        <Review
          proposals={proposals}
          drafts={drafts}
          finds={finds}
          findsIn={findsIn}
          selected={selected}
          onOpen={(key) => {
            onFocus(key);
            onTab("professor");
          }}
        />
      ) : tab === "professor" ? (
        <ProfessorTab recordKey={focus} proposals={proposals} />
      ) : (
        <SourceTab recordKey={focus} proposals={proposals} />
      )}
    </>
  );
}
