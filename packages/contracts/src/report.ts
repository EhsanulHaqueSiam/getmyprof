// The progress report: one page for a parent paying the fees, a counselor, or the applicant. It
// carries counts, the shortlist, replies and the next 30 days, never facts, drafts, email bodies,
// fit scores or notes, so it is safe to print or send to a counselor's getmyprof (the hub).
import { z } from "zod";
import { type Applicant, type Hunt, type Professor, schoolFor } from "./domain.ts";
import { deadlines } from "./deadlines.ts";
import type { OutreachMessage } from "./outreach.ts";
import { SchoolTier, type VaultState } from "./vault.ts";

export const ProgressReport = z.object({
  /** When it was made, ISO. */
  at: z.string(),
  /** The hunt in a line, e.g. "Fall 2027 · funded PhD". */
  hunt: z.string(),
  counts: z.object({
    schools: z.number(),
    professors: z.number(),
    emailed: z.number(),
    replied: z.number(),
    applications: z.number(),
  }),
  /** Kept schools by tier, with what the hunt holds at each. */
  shortlist: z.array(
    z.object({
      tier: SchoolTier,
      name: z.string(),
      professors: z.number(),
      emailed: z.number(),
      replied: z.number(),
      deadline: z.string().nullable(),
    }),
  ),
  /** Real replies, newest first: who, and what they asked for in a line. */
  replies: z.array(
    z.object({ name: z.string(), university: z.string(), note: z.string(), at: z.string() }),
  ),
  /** Dated steps in the next 30 days. */
  upcoming: z.array(z.object({ date: z.string(), title: z.string() })),
});
export type ProgressReport = z.infer<typeof ProgressReport>;

const DEGREE_LABEL = { phd: "funded PhD", ms_phd: "funded MS + PhD", funded_ms: "funded master's" };
const TIER_ORDER = { reach: 0, match: 1, safety: 2 };

/** Builds the report from what the store holds. Pure, so the server, the hub and tests share it. */
export function buildReport(input: {
  hunt: Hunt | null;
  vault: VaultState;
  records: Professor[];
  messages: OutreachMessage[];
  applicant: Applicant | undefined;
  now?: Date;
}): ProgressReport {
  const { hunt, vault, records, messages, applicant, now = new Date() } = input;
  const kept = vault.schools.filter((s) => s.status === "kept");
  const sent = (key: string) =>
    messages.some((m) => m.recordKey === key && m.direction === "out" && m.status === "sent");
  const answered = (key: string) =>
    messages.some(
      (m) =>
        m.recordKey === key &&
        m.direction === "in" &&
        (m.kind === "reply" || m.kind === "linkedin"),
    );
  const at = (name: string) => records.filter((r) => schoolFor(kept, r.university)?.name === name);
  const program = (name: string) =>
    vault.programs
      .filter((p) => schoolFor(kept, p.university)?.name === name && p.deadline)
      .map((p) => p.deadline ?? "")
      .toSorted()[0] ?? null;
  const until = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const byKey = new Map(records.map((r) => [r.key, r]));
  return {
    at: now.toISOString(),
    hunt: hunt
      ? [hunt.prefs.intake, hunt.prefs.degrees.map((d) => DEGREE_LABEL[d]).join(" or ")]
          .filter(Boolean)
          .join(" · ")
      : "No hunt yet",
    counts: {
      schools: kept.length,
      professors: records.length,
      emailed: records.filter((r) => sent(r.key)).length,
      replied: records.filter((r) => answered(r.key)).length,
      applications: vault.applications.filter((a) => a.status !== "planning").length,
    },
    shortlist: kept
      .toSorted((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.name.localeCompare(b.name))
      .map((s) => {
        const there = at(s.name);
        return {
          tier: s.tier,
          name: s.name,
          professors: there.length,
          emailed: there.filter((r) => sent(r.key)).length,
          replied: there.filter((r) => answered(r.key)).length,
          deadline: program(s.name),
        };
      }),
    replies: messages
      .filter((m) => m.direction === "in" && (m.kind === "reply" || m.kind === "linkedin"))
      .flatMap((m) => {
        const r = byKey.get(m.recordKey);
        return r
          ? [{ name: r.name, university: r.university, note: m.note, at: m.at ?? m.createdAt }]
          : [];
      })
      .toSorted((a, b) => b.at.localeCompare(a.at)),
    upcoming: deadlines(vault, applicant, now)
      .filter((d) => d.date <= until)
      .map((d) => ({ date: d.date, title: d.title })),
  };
}
