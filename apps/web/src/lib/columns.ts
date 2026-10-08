// The Results grid's columns by detail level, and its row rules: what Filter searches, which
// rows show dimmed, and each cell's tone.
import type { DetailLevel, Professor } from "@getmyprof/contracts";

export type Col = {
  key: keyof Professor | "select";
  label: string;
  source?: string;
  level: DetailLevel;
};
export const COLUMNS: Col[] = [
  { key: "fit", label: "Fit", level: "brief" },
  { key: "name", label: "Professor", source: "web · free", level: "brief" },
  { key: "niche", label: "Works on", source: "OpenAlex, page · free", level: "std" },
  { key: "moneyTier", label: "Money tier", level: "brief" },
  { key: "taking", label: "Taking students?", source: "page · free", level: "brief" },
  { key: "seeking", label: "Looking for", source: "page · free", level: "std" },
  { key: "money", label: "Money", source: "NSF, NIH · free", level: "brief" },
  { key: "emailCheck", label: "Email", source: "page free · find $0.0048", level: "brief" },
  { key: "lasts", label: "Lasts", source: "awards · free", level: "std" },
  { key: "eligibility", label: "Eligible", level: "std" },
  { key: "contact", label: "Contact rule", source: "page · free", level: "std" },
  { key: "stage", label: "Stage", level: "std" },
  { key: "recent", label: "Recent work", source: "OpenAlex, Scholar · free", level: "deep" },
  { key: "fitsBecause", label: "Fits because", source: "your profile", level: "deep" },
  { key: "sources", label: "Sources", level: "deep" },
];
export const RANK: Record<DetailLevel, number> = { brief: 0, std: 1, deep: 2 };

export const TIER_LABEL = ["?", "1 clear", "2 strong", "3 indirect", "4 none"];

/** Everything a row says, for the Filter box. */
export const haystack = (r: Professor) =>
  [r.name, r.university, r.department, r.niche, r.money, r.lasts, r.taking, r.email, r.emailCheck]
    .concat([r.contact, r.stage, r.fitsBecause, r.eligibility, r.seeking, r.recent])
    .concat(TIER_LABEL[r.moneyTier] ?? "")
    .join(" ")
    .toLowerCase();

/** A row out of the running: skipped, or the applicant can't be paid there. Shown dimmed. */
export const dimmed = (r: Professor) => r.stage === "skip" || r.eligibility.startsWith("no");

export function tone(key: Col["key"], value: string) {
  const v = value.toLowerCase();
  if (key === "moneyTier")
    return v.startsWith("1") || v.startsWith("2")
      ? "text-success-foreground"
      : v.startsWith("3")
        ? "text-warning-foreground"
        : "text-muted-foreground";
  if (key === "eligibility")
    return v.startsWith("no")
      ? "text-destructive-foreground"
      : v === "ok"
        ? "text-success-foreground"
        : "";
  if (key === "taking")
    return v.startsWith("yes")
      ? "text-success-foreground"
      : v.startsWith("no")
        ? "text-destructive-foreground"
        : "";
  if (key === "emailCheck")
    return v === "ok"
      ? "text-success-foreground"
      : /bounce|invalid/.test(v)
        ? "text-destructive-foreground"
        : "text-muted-foreground";
  return "";
}
