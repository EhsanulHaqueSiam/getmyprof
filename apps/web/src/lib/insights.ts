// What gets a reply: of the first emails sent, how many were answered, overall and by money
// tier, length, the weekday they landed and, once the sheet carries them, a hook or a warm path.
// For the reply insights panel. The counts are small, so they inform and never rank anyone.
import { type Conversation, stripCitations } from "@getmyprof/contracts";

export type Bucket = { label: string; sent: number; replied: number };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A record field the sheet may not carry yet: filled or not, or undefined while it doesn't exist. */
const filled = (record: object, key: string) => {
  const entry = Object.entries(record).find(([k]) => k === key);
  if (!entry) return undefined;
  return typeof entry[1] === "string" ? entry[1].trim() !== "" : Boolean(entry[1]);
};

export function replyInsights(conversations: Conversation[]) {
  const firsts = conversations.flatMap((c) => {
    const first = c.messages.find(
      (m) =>
        m.direction === "out" &&
        m.channel === "email" &&
        m.touch === "first" &&
        m.status === "sent",
    );
    if (!first) return [];
    // A real answer, not a bounce or an out-of-office.
    const replied = c.messages.some(
      (m) => m.direction === "in" && (m.kind === "reply" || m.kind === "linkedin"),
    );
    return [{ record: c.record, first, replied }];
  });
  type Row = (typeof firsts)[number];
  /** Counts each first email under its label, in the labels' order, dropping empty ones. */
  const by = (order: string[], labelOf: (row: Row) => string | null): Bucket[] =>
    order
      .map((label) => {
        const rows = firsts.filter((r) => labelOf(r) === label);
        return { label, sent: rows.length, replied: rows.filter((r) => r.replied).length };
      })
      .filter((b) => b.sent > 0);
  const words = (r: Row) => stripCitations(r.first.body).split(/\s+/).filter(Boolean).length;
  const hook = (r: Row) => {
    const [hooked, warm] = [filled(r.record, "hook"), filled(r.record, "warmPath")];
    if (hooked === undefined && warm === undefined) return null;
    return hooked || warm ? "Hook or warm path" : "Neither";
  };
  return {
    sent: firsts.length,
    replied: firsts.filter((r) => r.replied).length,
    byTier: by(["Tier 1", "Tier 2", "Tier 3", "Tier 4", "No tier"], (r) =>
      r.record.moneyTier ? `Tier ${r.record.moneyTier}` : "No tier",
    ),
    byLength: by(["Under 100 words", "100 to 150 words", "Over 150 words"], (r) => {
      const n = words(r);
      return n < 100 ? "Under 100 words" : n <= 150 ? "100 to 150 words" : "Over 150 words";
    }),
    // The day it landed for the professor, in their time zone.
    byWeekday: by(WEEKDAYS, (r) =>
      r.first.at
        ? new Date(r.first.at).toLocaleDateString("en-US", {
            weekday: "short",
            timeZone: r.first.timeZone || undefined,
          })
        : null,
    ),
    // Empty until the sheet records a hook or a warm path; it reads the record as it is now.
    byHook: by(["Hook or warm path", "Neither"], hook),
  };
}
