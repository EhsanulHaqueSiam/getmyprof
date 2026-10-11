// The Results grid's columns by detail level, and its row rules: what Filter searches, which
// rows show dimmed, and each cell's tone.
import { type DetailLevel, FIELD_LEVEL, type Professor } from "@getmyprof/contracts";

export type Col = {
  key: keyof Professor | "select";
  label: string;
  source?: string;
  level: DetailLevel;
};
export const COLUMNS: Col[] = [
  { key: "fit", label: "Fit", level: FIELD_LEVEL.fit },
  { key: "name", label: "Professor", source: "web · free", level: FIELD_LEVEL.name },
  { key: "niche", label: "Works on", source: "OpenAlex, page · free", level: FIELD_LEVEL.niche },
  { key: "moneyTier", label: "Money tier", level: FIELD_LEVEL.moneyTier },
  { key: "taking", label: "Taking students?", source: "page · free", level: FIELD_LEVEL.taking },
  { key: "seeking", label: "Looking for", source: "page · free", level: FIELD_LEVEL.seeking },
  { key: "money", label: "Money", source: "NSF, NIH · free", level: FIELD_LEVEL.money },
  {
    key: "emailCheck",
    label: "Email",
    source: "page free · find $0.0048",
    level: FIELD_LEVEL.emailCheck,
  },
  { key: "lasts", label: "Lasts", source: "awards · free", level: FIELD_LEVEL.lasts },
  { key: "eligibility", label: "Eligible", level: FIELD_LEVEL.eligibility },
  { key: "contact", label: "Contact rule", source: "page · free", level: FIELD_LEVEL.contact },
  { key: "stage", label: "Stage", level: FIELD_LEVEL.stage },
  {
    key: "recent",
    label: "Recent work",
    source: "OpenAlex, Scholar · free",
    level: FIELD_LEVEL.recent,
  },
  { key: "hook", label: "Way in", source: "OpenAlex, your profile", level: FIELD_LEVEL.hook },
  {
    key: "fitsBecause",
    label: "Fits because",
    source: "your profile",
    level: FIELD_LEVEL.fitsBecause,
  },
  { key: "sources", label: "Sources", level: FIELD_LEVEL.sources },
];

export const TIER_LABEL = ["?", "1 clear", "2 strong", "3 indirect", "4 none"];

/** Everything a row says, for the Filter box. */
export const haystack = (r: Professor) =>
  [r.name, r.university, r.department, r.niche, r.money, r.lasts, r.taking, r.email, r.emailCheck]
    .concat([r.contact, r.stage, r.fitsBecause, r.eligibility, r.seeking, r.recent])
    .concat([r.lab, r.warm, r.hook])
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
