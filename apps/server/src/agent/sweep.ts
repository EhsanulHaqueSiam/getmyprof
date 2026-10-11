// A hunt's sweep: everyone its discovery tools surfaced (award PIs, CSRankings faculty publishing
// in the field's venues, OpenAlex topic authors), and whether each was checked: proposed, already
// known (sheet, Review, rejected) or skipped with a reason. One live hunt proposed 11 to 14 of the
// 18 fits three runs found between them; the sweep makes it check them all. The runner sends the
// agent back while anyone is unchecked (sweepNudge), and sweep_status shows the list.
import { fullName, type HuntPrefs, sameSchool } from "@getmyprof/contracts";
import { z } from "zod";
import { type Db, getKv, setKv } from "../db.ts";
import { knownKey, threadProposals } from "../records.ts";

const Person = z.object({
  name: z.string(),
  university: z.string(),
  via: z.string(),
  skipped: z.string().optional(),
});
type Person = z.infer<typeof Person>;
const Sweep = z.array(Person);

const key = (threadId: string) => `sweep.${threadId}`;
const read = (db: Db, threadId: string) => getKv(db, key(threadId), (v) => Sweep.parse(v), []);
const same = (a: { name: string; university: string }, b: { name: string; university: string }) =>
  fullName(a.name) === fullName(b.name) && sameSchool(a.university, b.university);

/** Notes people a discovery tool surfaced; each must be checked before the hunt is done. */
export function surface(db: Db, threadId: string, people: Omit<Person, "skipped">[]) {
  const all = read(db, threadId);
  for (const p of people) if (p.name && !all.some((x) => same(x, p))) all.push(p);
  setKv(db, key(threadId), all);
}

/** Records why the agent passed on people: checked, and not a fit. */
export function skip(
  db: Db,
  threadId: string,
  people: { name: string; university: string; why: string }[],
) {
  const all = read(db, threadId);
  for (const p of people) {
    const at = all.find((x) => same(x, p));
    if (at) at.skipped = p.why;
    else all.push({ name: p.name, university: p.university, via: "agent", skipped: p.why });
  }
  setKv(db, key(threadId), all);
}

/** Who was surfaced and not yet checked, by school. */
export function unchecked(db: Db, threadId: string) {
  const proposed = threadProposals(db, threadId).map((p) => ({
    name: p.recordName,
    university: p.university,
  }));
  return read(db, threadId).filter(
    (p) =>
      !p.skipped &&
      !proposed.some((x) => same(x, p)) &&
      knownKey(db, p.name, p.university) === null,
  );
}

/** The message that sends the agent back to finish a sweep, or null when nobody is left. */
export function sweepNudge(db: Db, threadId: string) {
  const left = unchecked(db, threadId);
  if (!left.length) return null;
  const bySchool = Map.groupBy(left, (p) => p.university);
  const lines = [...bySchool].map(
    ([school, people]) => `${school}: ${people.map((p) => `${p.name} (${p.via})`).join(", ")}`,
  );
  return `The sweep isn't done: ${left.length} people your tools found haven't been checked yet.\n${lines.join("\n")}\nRead each one and propose the fits; pass on the rest with skip_candidates and a reason.`;
}

/** CSRankings venues for a hunt's fields: NLP fields read acl, emnlp and naacl authors. */
const FIELD_VENUES: [RegExp, string[]][] = [
  [/language|nlp|linguistic|text|speech|translation/i, ["acl", "emnlp", "naacl"]],
  [/machine learning|deep learning|\bml\b|neural|learning theory/i, ["icml", "nips", "iclr"]],
  [/vision|image|video|graphics/i, ["cvpr", "iccv", "eccv"]],
  [/robot/i, ["icra", "iros", "rss"]],
  [/human-computer|hci|interaction|visuali/i, ["chiconf", "uist"]],
  [/security|privacy|crypto/i, ["ccs", "oakland", "usenixsec", "ndss"]],
  [/data mining|recommend|retrieval|web|search/i, ["kdd", "www", "sigir"]],
  [/database|data management/i, ["sigmod", "vldb"]],
  [/artificial intelligence|\bai\b|reasoning|planning/i, ["aaai", "ijcai"]],
];

/** The venues that put a CSRankings author in the hunt's fields or the ones next to them. */
export function fieldVenues(prefs?: Pick<HuntPrefs, "fields" | "adjacent">) {
  const words = [...(prefs?.fields ?? []), ...(prefs?.adjacent ?? [])].join(" ");
  return new Set(FIELD_VENUES.flatMap(([re, venues]) => (re.test(words) ? venues : [])));
}

/** "acl 5, emnlp 3" has 8 papers in {acl, emnlp}: 2 or more makes someone a candidate. */
export const papersIn = (venues: string, wanted: Set<string>) =>
  venues
    .split(", ")
    .map((v) => v.split(" "))
    .reduce((n, [venue = "", count = "0"]) => n + (wanted.has(venue) ? Number(count) : 0), 0);
