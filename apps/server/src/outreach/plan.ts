// When outreach goes out and comes back: send slots, warm-up caps, follow-up timing, and what
// an incoming message is. Pure functions; the mail sync and send queue call them.
import type { MailKind } from "@gradcode/contracts";

/** Milliseconds a zone is ahead of UTC at `ts`. */
function zoneOffset(ts: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(ts);
  const v = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  return (
    Date.UTC(
      v.year ?? 0,
      (v.month ?? 1) - 1,
      v.day ?? 1,
      v.hour ?? 0,
      v.minute ?? 0,
      v.second ?? 0,
    ) - ts
  );
}

/** The instant a wall-clock time happens in a zone. */
export function zonedInstant(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  return new Date(guess - zoneOffset(guess, timeZone));
}

const localDay = (ts: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(ts);

/** Sends per day for a new mailbox: 5 in week 1, 10 in week 2, then 15. */
export function dailyCap(warmupStart: Date, day: Date) {
  const week = Math.floor((day.getTime() - warmupStart.getTime()) / (7 * 864e5));
  return week <= 0 ? 5 : week === 1 ? 10 : 15;
}

export type Scheduled = { at: Date; university: string };

/**
 * The next free send slot for a professor: 08:00 their time, Tuesday to Thursday, 5 minutes
 * after the last send that morning, within the day's warm-up cap and 2 per university a day.
 */
export function nextSlot(opts: {
  now: Date;
  timeZone: string;
  university: string;
  scheduled: Scheduled[];
  warmupStart: Date;
}): Date {
  const { now, timeZone, university, scheduled, warmupStart } = opts;
  for (let i = 0; i < 60; i++) {
    const probe = new Date(now.getTime() + i * 864e5);
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(probe)
      .split("-")
      .map(Number);
    const [y = 0, m = 1, d = 1] = ymd;
    const opening = zonedInstant(y, m, d, 8, 0, timeZone);
    if (!["Tue", "Wed", "Thu"].includes(localDay(opening.getTime(), timeZone))) continue;
    const sameDay = scheduled.filter(
      (s) => Math.abs(s.at.getTime() - opening.getTime()) < 12 * 36e5,
    );
    if (sameDay.length >= dailyCap(warmupStart, opening)) continue;
    if (sameDay.filter((s) => s.university === university).length >= 2) continue;
    const slot = new Date(opening.getTime() + sameDay.length * 5 * 6e4);
    if (slot > now) return slot;
  }
  throw new Error("no send slot in the next 60 days");
}

/** Adds business days (Mon to Fri) in UTC. */
export function addBusinessDays(from: Date, days: number) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/**
 * When the next follow-up is due: `days` business days after the first email (the hunt's
 * setting, 7 and 14 by default), then the sequence stops.
 */
export function followUpDue(
  firstSentAt: Date,
  followUpsSent: number,
  days: readonly number[] = [7, 14],
) {
  const n = days[followUpsSent];
  return n === undefined ? null : addBusinessDays(firstSentAt, n);
}

/** What an incoming message is, from headers and the first lines. The agent reads real replies. */
export function classifyMail(m: { from: string; subject: string; body: string }): MailKind {
  const from = m.from.toLowerCase();
  const subject = m.subject.toLowerCase();
  const head = m.body.slice(0, 600).toLowerCase();
  if (
    /mailer-daemon|postmaster/.test(from) ||
    /undeliverable|delivery status notification|returned mail|delivery has failed/.test(subject)
  )
    return "bounce";
  if (
    /linkedin\.com/.test(from) &&
    /(sent you a message|new message|replied to your message)/.test(subject + head)
  )
    return "linkedin";
  if (
    /^(automatic reply|auto:|out of office|autoreply)/.test(subject) ||
    /\bout of (the )?office\b|on leave until|away until/.test(head)
  )
    return "auto-reply";
  return "reply";
}

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const RETURN = new RegExp(
  `\\b(?:until|returning(?: on)?|back(?: on)?|return on)\\s+(?:[a-z]+day,?\\s+)?(${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?)`,
  "i",
);

/** A calendar date at noon UTC, so it reads as the same day in every time zone. */
function calendarDay(text: string) {
  const d = new Date(text);
  return Number.isNaN(d.getTime())
    ? null
    : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
}

/** The day an out-of-office note says they are back, e.g. "until October 20, 2026". */
export function returnDate(text: string, now: Date): Date | null {
  const found = RETURN.exec(text)?.[1];
  if (!found) return null;
  const clean = found.replace(/(\d)(st|nd|rd|th)/i, "$1").replace(".", "");
  if (/\d{4}/.test(clean)) return calendarDay(clean);
  // No year: the next time that date comes round.
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const d = calendarDay(`${clean} ${year}`);
    if (!d) return null;
    if (d.getTime() >= now.getTime() - 864e5) return d;
  }
  return null;
}
