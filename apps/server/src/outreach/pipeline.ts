// Everyone in the Pipeline and where they stand: stage and turn from their messages
// (store.ts), joined with what the rest of the hunt knows (applications, offers, the hunt's
// follow-up timing). Derived on every read, never stored.
import { addressChecked, type Conversation, type Professor, Touch } from "@gradcode/contracts";
import type { Db } from "../db.ts";
import { listRecords } from "../records.ts";
import { sameSchool } from "../sources.ts";
import { getHunt } from "../state.ts";
import { listApplications, listOffers, listPrograms } from "../vault.ts";
import { listMessages, standing } from "./store.ts";

/** A professor in the sheet who could be written to now: a checked address and no rule against it. */
const toContact = (r: Professor) =>
  r.stage === "new" && !!r.email && addressChecked(r.emailCheck) && !/^apply-only/i.test(r.contact);

/**
 * Everyone in the pipeline: anyone with outreach, an app record already past "new", a professor
 * ready to contact, or one a submitted application names.
 */
export function conversations(db: Db, at = new Date()): Conversation[] {
  const all = listMessages(db);
  const programs = listPrograms(db);
  const applications = listApplications(db).filter(
    (a) => a.status !== "planning" && a.status !== "in-progress" && a.status !== "declined",
  );
  const offers = listOffers(db).filter((o) => o.status !== "declined");
  const ended = offers.some((o) => o.status === "accepted");
  const followUpDays = getHunt(db)?.prefs.followUpDays ?? [7, 14];
  return listRecords(db)
    .flatMap((record) => {
      const messages = all.filter((m) => m.recordKey === record.key);
      const app = applications.find((a) => a.professors.includes(record.key));
      const program =
        programs.find((p) => p.id === app?.programId) ??
        programs.find((p) => sameSchool(p.university, record.university));
      // An offer moves only the professors its application named.
      const offer =
        app && program
          ? offers.find((o) => sameSchool(o.university, program.university))
          : undefined;
      const inPlay =
        messages.length > 0 ||
        !!app ||
        (record.origin === "app" &&
          (["drafted", "sent", "replied"].includes(record.stage) || toContact(record)));
      if (!inPlay) return [];
      const s = standing(record, messages, at, {
        applied: !!app,
        offer: !!offer,
        ended,
        followUpDays,
      });
      return [
        {
          record,
          messages,
          stage: s.stage,
          turn: s.turn,
          followUpAt: s.followUpAt,
          stopped: s.stopped,
          lastAt: s.lastAt,
          program: program ? { name: program.name, deadline: program.deadline } : null,
          applied: app ? { status: app.status, submittedAt: app.submittedAt } : null,
          offer: offer ? { status: offer.status } : null,
        },
      ];
    })
    .toSorted((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Follow-ups due now with no draft yet, and which step each one is. */
export function followUpsToDraft(db: Db, at = new Date()) {
  return conversations(db, at).flatMap((c) => {
    if (c.stage !== "follow-up") return [];
    const sent = c.messages.filter((m) => m.direction === "out" && m.status === "sent");
    const step = Touch.safeParse(
      `follow-up-${sent.filter((m) => m.touch?.startsWith("follow-up")).length + 1}`,
    );
    if (!step.success) return [];
    const touch = step.data;
    const drafted = c.messages.some(
      (m) => m.direction === "out" && m.touch === touch && m.status !== "cancelled",
    );
    return drafted ? [] : [{ record: c.record, touch, last: sent.at(-1) }];
  });
}
