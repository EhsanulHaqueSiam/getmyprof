// Recommenders whose letter is still missing get a gentle reminder 14 and 3 days before the
// deadline. The agent drafts a short note into the Writer; recommenders aren't in the professor
// sheet, so the applicant sends it. Each reminder is asked for once.
import { z } from "zod";
import { type Db, getKv, setKv } from "./db.ts";
import { listApplications, listPrograms } from "./vault.ts";

const MILESTONES = [14, 3] as const;

/** Reminders due now: one per recommender, application and milestone not yet asked for. */
export function dueReminders(db: Db, now = new Date()) {
  const asked = new Set(
    getKv(db, "recommenders.reminded", (v) => z.array(z.string()).parse(v), []),
  );
  const programs = listPrograms(db);
  return listApplications(db).flatMap((app) => {
    const program = programs.find((p) => p.id === app.programId);
    if (!program?.deadline || !["planning", "in-progress"].includes(app.status)) return [];
    const days = Math.ceil((Date.parse(`${program.deadline}T23:59:59Z`) - now.getTime()) / 864e5);
    const milestone = MILESTONES.findLast((m) => days <= m);
    if (milestone === undefined || days < 0) return [];
    return app.recommenders
      .filter((r) => r.status === "asked" || r.status === "agreed")
      .map((r) => ({
        key: `${app.id}:${r.name}:${milestone}`,
        about: `Reminder to ${r.name} (${r.email || "no email"}): their recommendation letter for ${program.university} ${program.name} is due ${program.deadline}, ${days} day${days === 1 ? "" : "s"} from now. Short, warm and thankful; offer anything they need.`,
      }))
      .filter((r) => !asked.has(r.key));
  });
}

export function markReminded(db: Db, keys: string[]) {
  const asked = getKv(db, "recommenders.reminded", (v) => z.array(z.string()).parse(v), []);
  setKv(db, "recommenders.reminded", [...new Set([...asked, ...keys])]);
}
