// What a professor's page shows beyond the record: where each field's value came from and when,
// a dated timeline, the latest email's state and their school's programs (records.get), and
// their grants, recent work and interests from free APIs (records.scholarly).
import type { Award, OutreachMessage, Professor, Proposal } from "@gradcode/contracts";
import type { Sources } from "./agent/tools.ts";
import type { Db } from "./db.ts";
import { listMessages } from "./outreach/store.ts";
import { personKey } from "./records.ts";
import { monthsAfter, sameSchool } from "./sources.ts";
import { listPrograms } from "./vault.ts";

/** Each field's current value: the sources and date of the latest accepted change to it. */
export function fieldSources(proposals: Proposal[]) {
  const out: Record<string, { sources: string[]; at: string }> = {};
  const accepted = proposals
    .filter((p) => p.status === "accepted")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const p of accepted)
    for (const c of p.changes) out[c.field] = { sources: p.sources, at: p.createdAt };
  return out;
}

const LABEL: Record<string, string> = { emailCheck: "email check", fitsBecause: "fits because" };

/** The record's history, newest first: what was decided, and what went out or came back. */
export function timeline(proposals: Proposal[], messages: OutreachMessage[]) {
  const decided = proposals
    .filter((p) => p.status !== "pending")
    .map((p) => {
      const fields = p.changes
        .filter((c) => c.field !== "name" && c.field !== "university")
        .map((c) => LABEL[c.field] ?? c.field)
        .join(", ");
      const text =
        p.kind === "add"
          ? p.status === "accepted"
            ? "Added to the sheet"
            : "Rejected as new"
          : `${p.status === "accepted" ? "Updated" : "Change rejected"}: ${fields}`;
      return { at: p.createdAt, text };
    });
  const mail = messages
    .filter((m) => m.direction === "in" || m.status !== "draft")
    .map((m) => ({
      at: m.at ?? m.createdAt,
      text:
        m.direction === "in"
          ? `${m.kind === "reply" ? "They replied" : (m.kind ?? "Mail")}: ${m.subject}`
          : `${m.status === "sent" ? "Sent" : m.status === "scheduled" ? "Scheduled" : m.status} ${m.touch ?? ""}: ${m.subject}`,
    }));
  return [...decided, ...mail].toSorted((a, b) => b.at.localeCompare(a.at));
}

/** Everything records.get adds to the record. */
export function pageExtras(db: Db, record: Professor, proposals: Proposal[]) {
  const messages = listMessages(db, record.key);
  const last = messages.findLast((m) => m.direction === "out");
  return {
    fieldSources: fieldSources(proposals),
    timeline: timeline(proposals, messages),
    draft: last
      ? {
          id: last.id,
          status: last.status,
          touch: last.touch ?? "",
          subject: last.subject,
          at: last.at ?? last.scheduledAt ?? last.createdAt,
        }
      : null,
    programs: listPrograms(db)
      .filter((p) => sameSchool(p.university, record.university))
      .map((p) => ({ name: p.name, deadline: p.deadline, funding: p.funding })),
  };
}

/**
 * A professor's grants (NSF and NIH, as PI), recent work and interests (OpenAlex), each with a
 * link to its source. Free APIs; one that fails just leaves its part empty.
 */
export async function scholarly(sources: Sources, r: Professor, intake: Date | null) {
  const [nsf, nih, author] = await Promise.allSettled([
    sources.nsf({ terms: [], pi: r.name, university: r.university }),
    sources.nih({ terms: [], pi: r.name, university: r.university }),
    sources.openalex(r.name, r.university),
  ]);
  const awards = [nsf, nih].flatMap((x) => (x.status === "fulfilled" ? x.value : []));
  const grants: Award[] = awards
    // A PI search can match someone else with the same name elsewhere.
    .filter((a) => personKey(a.pi) === personKey(r.name) && sameSchool(a.university, r.university))
    .map((a) => ({ ...a, monthsAfterIntake: monthsAfter(a.ends, intake), inSheet: true, fit: 0 }))
    .toSorted((a, b) => (b.ends ?? "").localeCompare(a.ends ?? ""));
  const found = author.status === "fulfilled" ? author.value : null;
  return { grants, works: found?.recent ?? [], interests: found?.topics ?? [] };
}
