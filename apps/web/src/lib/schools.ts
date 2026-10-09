// The Schools page's rows: each school on the shortlist with the program closing first, the
// professors found there and who was emailed, joined by name; what its stipend leaves after rent;
// and the prompt that fills each tier.
import {
  type HuntPrefs,
  type Professor,
  type Program,
  type School,
  type SchoolTier,
  schoolFor,
} from "@getmyprof/contracts";
import { leftAfterRent } from "./vault";

export const TIERS = ["reach", "match", "safety"] as const satisfies readonly SchoolTier[];

/** Each tier's hue: safety reads as safe, reach as a stretch. */
export const TIER_TONE: Record<SchoolTier, string> = {
  reach: "text-info-foreground",
  match: "text-foreground",
  safety: "text-success-foreground",
};

/** Each school with its first program to close, its professors, and how many have money or mail. */
export function schoolRows<
  P extends Pick<Professor, "university" | "moneyTier" | "stage">,
  G extends Pick<Program, "university" | "deadline">,
>(schools: School[], programs: G[], records: P[]) {
  // Each professor and program belongs to one school on the list, so two similar names never share.
  const home = <T>(list: T[], university: (x: T) => string) => {
    const by = new Map<string, T[]>();
    for (const x of list) {
      const id = schoolFor(schools, university(x))?.id;
      if (id) by.set(id, [...(by.get(id) ?? []), x]);
    }
    return by;
  };
  const professorsAt = home(records, (r) => r.university);
  const programsAt = home(programs, (p) => p.university);
  return schools.map((school) => {
    const professors = professorsAt.get(school.id) ?? [];
    return {
      school,
      // Undated programs sort last.
      program:
        (programsAt.get(school.id) ?? []).toSorted((a, b) =>
          (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
        )[0] ?? null,
      professors,
      funded: professors.filter((p) => p.moneyTier === 1 || p.moneyTier === 2).length,
      emailed: professors.filter((p) => p.stage === "sent" || p.stage === "replied").length,
    };
  });
}

/** One school as the page shows it, with the full records and programs behind it. */
export type SchoolRow = ReturnType<typeof schoolRows<Professor, Program>>[number];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * "$18.8k after rent", from a school's yearly stipend and monthly rent, with the figures behind it
 * for a tooltip; null until both are known. With dependents, rent is for a family home.
 */
export function afterRent(s: Pick<School, "stipendUsd" | "rentUsd">, family = false) {
  const { stipendUsd: stipend, rentUsd: rent } = s;
  const left = leftAfterRent({ stipend, stipendPer: "year", rentPerMonth: rent }, family);
  if (left === null || stipend === null || rent === null) return null;
  return {
    text: `${left < 0 ? "-" : ""}$${(Math.abs(left) / 1000).toFixed(1)}k after rent`,
    title: `stipend ${usd(stipend)} a year, rent ${usd(rent)} a month${family ? ", 1.4× for a family home" : ""}`,
  };
}

/** Asks the agent for schools to bring each tier up to the hunt's mix, at least one each. */
export function suggestPrompt(schools: School[], sweep: HuntPrefs["sweep"]) {
  const listed = (t: SchoolTier) =>
    schools.filter((s) => s.tier === t && s.status !== "dropped").length;
  const want = TIERS.map((t) => `${Math.max(1, sweep[t] - listed(t))} ${t}`);
  return `Suggest schools for my shortlist: ${want.join(", ")}.`;
}
