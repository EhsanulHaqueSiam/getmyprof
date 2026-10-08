// The hunt's deadlines as a calendar feed a calendar app subscribes to once:
// GET /api/calendar.ics?token=<the MCP token in Settings>. Calendar apps can't send a header, so
// the token rides in the query string; the feed only reads.
import { type Deadline, deadlines } from "@getmyprof/contracts";
import type { Db } from "./db.ts";
import { sameToken } from "./mcp.ts";
import { getApplicant, getSettings } from "./state.ts";
import { vaultState } from "./vault.ts";

/** RFC 5545 TEXT: backslash, semicolon, comma and newlines escaped. */
const text = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

const utf8 = new TextEncoder();
/** Folds a content line at 75 octets, continuing with CRLF and a space, never inside a character. */
function fold(line: string) {
  const parts: string[] = [];
  let part = "";
  let size = 0;
  for (const ch of line) {
    const n = utf8.encode(ch).length;
    // A continuation's leading space counts toward its 75.
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(part);
      part = "";
      size = 0;
    }
    part += ch;
    size += n;
  }
  return [...parts, part].join("\r\n ");
}

/** One all-day VEVENT per item, with a UID stable across fetches so events update in place. */
export function calendarIcs(items: Deadline[], stamp = new Date()) {
  const at = `${stamp.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//getmyprof//deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:getmyprof",
    ...items.flatMap((d) => [
      "BEGIN:VEVENT",
      `UID:${text(d.id)}@getmyprof`,
      `DTSTAMP:${at}`,
      `DTSTART;VALUE=DATE:${d.date.replaceAll("-", "")}`,
      `SUMMARY:${text(d.title)}`,
      ...(d.detail ? [`DESCRIPTION:${text(d.detail)}`] : []),
      ...(/^https?:\/\/\S+$/.test(d.url) ? [`URL:${d.url}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** The feed for a request URL (bin.ts writes it out), or null without the MCP token: a 401. */
export function calendarFeed(db: Db, url: string) {
  const token = new URL(url, "http://127.0.0.1").searchParams.get("token") ?? "";
  if (!sameToken(token, getSettings(db).mcpToken)) return null;
  return calendarIcs(deadlines(vaultState(db), getApplicant(db)));
}
