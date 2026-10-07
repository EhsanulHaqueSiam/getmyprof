import { type Award, AwardSource } from "@gradcode/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, MessageSquareIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { FellowshipsTable, ProgramsTable } from "~/components/FundingLists";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const Route = createFileRoute("/_shell/funding")({ component: Funding });

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", AUD: "A$" };
const money = (a: Pick<Award, "amount" | "currency">) =>
  a.amount == null
    ? "?"
    : `${SYMBOL[a.currency] ?? `${a.currency} `}${Math.round(a.amount).toLocaleString("en-US")}`;
const SOURCE_NOTE: Record<AwardSource, string> = {
  NSF: "US",
  NIH: "US",
  UKRI: "UK",
  CORDIS: "EU, ERC",
  ARC: "Australia",
};

/**
 * Follow the money: active awards in your fields from free databases (NSF, NIH, UKRI, CORDIS,
 * ARC), ranked by how long they last after your intake. Sources default to your hunt's places.
 */
function Funding() {
  const hunt = useStore((s) => s.app?.hunt);
  const navigate = useNavigate();
  // Defaults to the hunt's fields (which may load after first render) until the user types.
  const [typed, setTerms] = useState<string | null>(null);
  const terms = typed ?? hunt?.prefs.fields.join(", ") ?? "";
  const [schools, setSchools] = useState("");
  const [awards, setAwards] = useState<Award[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Award | null>(null);
  // null means "the hunt's places decide"; the server picks the same default.
  const [chosen, setChosen] = useState<AwardSource[] | null>(null);
  const [tab, setTab] = useState<"awards" | "programs" | "fellowships">("awards");

  /** One click: the PI goes into the sheet with this award as their grant. */
  const addPi = async (a: Award) => {
    await call("records.addFromAward", { award: a });
    const added = { ...a, inSheet: true };
    setAwards((all) => all?.map((x) => (x === a ? added : x)) ?? null);
    setPicked((p) => (p === a ? added : p));
  };

  const search = async () => {
    setBusy(true);
    try {
      const split = (s: string) =>
        s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      const found = await call("funding.search", {
        terms: split(terms).slice(0, 3),
        universities: split(schools).slice(0, 8),
        ...(chosen?.length ? { sources: chosen } : {}),
      });
      setAwards(found);
      setPicked(found[0] ?? null);
    } finally {
      setBusy(false);
    }
  };
  const vet = async (a: Award) => {
    const t = await call("threads.create", {
      text: a.pi
        ? `Vet ${a.pi} at ${a.university}. They hold ${a.source} award ${a.id} ("${a.title}", ends ${a.ends ?? "unknown"}). Are they taking students for my intake, and do they fit me? Propose them if they do.`
        : `${a.source} project ${a.id} ("${a.title}") at ${a.university} doesn't name its PI. Find who leads it (${a.url}), whether they take students for my intake, and propose them if they fit me.`,
      title: a.pi ? `Vet ${a.pi}` : `Find the PI of ${a.id}`,
    });
    void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
  };

  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_340px]">
      <section className="flex min-w-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2.5 px-4">
          <h1 className="font-semibold text-sm">Funding</h1>
          <div className="inline-flex rounded-lg border p-0.5 text-xs" role="tablist">
            {(["awards", "programs", "fellowships"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-6 rounded-md px-2.5 capitalize transition-colors",
                  tab === t
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <span className={cn("flex gap-1", tab !== "awards" && "hidden")}>
            {AwardSource.options.map((s) => {
              const on = chosen ? chosen.includes(s) : false;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  title={SOURCE_NOTE[s]}
                  onClick={() =>
                    setChosen((c) => {
                      const now = c ?? [];
                      return now.includes(s) ? now.filter((x) => x !== s) : [...now, s];
                    })
                  }
                  className={cn(
                    "h-6 rounded-md px-1.5 text-2xs transition-colors",
                    on
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              );
            })}
          </span>
          <span className={cn("text-muted-foreground text-xs", tab !== "awards" && "hidden")}>
            {chosen?.length ? "free" : "free · by your places"}
          </span>
        </header>
        {tab === "programs" ? (
          <div className="min-h-0 flex-1 overflow-auto border-t">
            <ProgramsTable />
          </div>
        ) : tab === "fellowships" ? (
          <div className="min-h-0 flex-1 overflow-auto border-t">
            <FellowshipsTable />
          </div>
        ) : null}
        <form
          hidden={tab !== "awards"}
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
          className="mx-4 mb-3 flex items-center gap-2 rounded-2xl border border-input bg-popover py-1.5 pr-1.5 pl-3.5 text-sm"
        >
          <SearchIcon className="size-3.5 text-muted-foreground" />
          <input
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="Topics, comma separated"
            aria-label="Topics"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-placeholder"
          />
          <span className="text-muted-foreground">/</span>
          <input
            value={schools}
            onChange={(e) => setSchools(e.target.value)}
            placeholder="Schools (default: your sheet)"
            aria-label="Schools"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-placeholder"
          />
          <Button size="xs" type="submit" disabled={busy || !terms.trim()}>
            {busy ? "Searching" : "Search"}
          </Button>
        </form>
        <div className={cn("min-h-0 flex-1 overflow-auto border-t", tab !== "awards" && "hidden")}>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["Award", "PI", "School", "Amount", "Ends", "Left after intake", "In sheet"].map(
                  (h) => (
                    <th
                      key={h}
                      className="sticky top-0 border-b border-input bg-background px-3 py-1.5 text-left font-medium text-muted-foreground text-xs whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(awards ?? []).map((a) => {
                const m = a.monthsAfterIntake;
                return (
                  <tr
                    key={`${a.source}${a.id}`}
                    onClick={() => setPicked(a)}
                    data-dimmed={a.fit === 0 || undefined}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-secondary",
                      picked === a && "bg-primary/7",
                      ((m !== null && m < 0) || a.fit === 0) && "opacity-45",
                    )}
                  >
                    <td className="h-9 max-w-[200px] truncate border-b px-3 text-secondary-label">
                      {a.title}
                    </td>
                    <td className="border-b px-3 font-medium whitespace-nowrap">
                      {a.pi || <span className="text-muted-foreground">not listed</span>}
                    </td>
                    <td className="max-w-[120px] truncate border-b px-3 text-secondary-label">
                      {a.university}
                    </td>
                    <td className="border-b px-3 tabular-nums">{money(a)}</td>
                    <td className="border-b px-3 whitespace-nowrap tabular-nums">
                      {a.ends?.slice(0, 7) ?? "?"}
                    </td>
                    <td className="border-b px-3 whitespace-nowrap">
                      {m === null ? (
                        "?"
                      ) : m < 0 ? (
                        <span className="text-muted-foreground">ends before you start</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-secondary">
                            <span
                              className={cn(
                                "block h-full rounded-full",
                                m >= 12 ? "bg-success" : "bg-warning",
                              )}
                              style={{ width: `${Math.min(100, (m / 36) * 100)}%` }}
                            />
                          </span>
                          <span className="tabular-nums">{m} mo</span>
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "border-b px-3 whitespace-nowrap",
                        a.inSheet ? "text-success-foreground" : "text-muted-foreground",
                      )}
                    >
                      {a.inSheet ? (
                        "yes"
                      ) : a.fit === 0 ? (
                        "off topic"
                      ) : a.pi ? (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            void addPi(a);
                          }}
                        >
                          <PlusIcon /> Add PI
                        </Button>
                      ) : (
                        "no PI listed"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {awards === null ? (
            <div className="px-6 py-16 text-center text-muted-foreground text-xs">
              Search your fields to see who has money that lasts past your intake.
            </div>
          ) : null}
          {awards?.length === 0 ? (
            <div className="px-6 py-16 text-center text-muted-foreground text-xs">
              No active awards matched.
            </div>
          ) : null}
        </div>
        {tab === "awards" && awards?.length ? (
          <div className="flex h-9 shrink-0 items-center gap-2 border-t px-4 text-muted-foreground text-xs">
            {awards.length} awards
            <span className="ml-auto">ranked by months left after your intake, then fit</span>
          </div>
        ) : null}
      </section>
      <aside className="flex flex-col gap-3 overflow-y-auto border-l p-4">
        {picked ? (
          <>
            <div className="text-muted-foreground text-xs">
              {picked.source} {picked.id} · {picked.starts?.slice(0, 7)} to{" "}
              {picked.ends?.slice(0, 7)}
            </div>
            <h2 className="font-semibold text-sm leading-snug">{picked.title}</h2>
            <div className="flex flex-wrap gap-3 text-muted-foreground text-xs">
              <span>
                PI <b className="text-foreground">{picked.pi || "not listed"}</b>
              </span>
              <span>{picked.university}</span>
              <b className="text-foreground">{money(picked)}</b>
            </div>
            {picked.abstract ? (
              <p className="text-secondary-label text-xs leading-relaxed">{picked.abstract}</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {picked.inSheet
                ? "In the sheet."
                : (picked.monthsAfterIntake ?? 0) > 0
                  ? `Not in the sheet. It runs ${picked.monthsAfterIntake} months past your intake, so this PI may be hiring.`
                  : "Not in the sheet, and it ends before you start."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" onClick={() => void vet(picked)}>
                <MessageSquareIcon /> Vet in a thread
              </Button>
              {!picked.inSheet && picked.pi ? (
                <Button variant="outline" size="xs" onClick={() => void addPi(picked)}>
                  <PlusIcon /> Add as candidate
                </Button>
              ) : null}
              <Button
                variant="ghost-muted"
                size="xs"
                render={<a href={picked.url} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon /> {new URL(picked.url).host}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            {tab === "awards"
              ? "Pick an award to see it here."
              : "Programs and fellowships are kept in the Vault, with their notes and status."}
          </p>
        )}
      </aside>
    </div>
  );
}
