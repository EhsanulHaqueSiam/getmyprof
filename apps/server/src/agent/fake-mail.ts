// The scripted agent's first messages to fixture professors (fake.ts). Each passes every draft
// check: their name, their newest paper by title and one detail of it, a confirmed fact cited,
// one question, and the CV when the vault has one.
import { addressChecked, factStatus, recentTitles } from "@getmyprof/contracts";
import { profileFacts } from "../adapters.ts";
import type { Db } from "../db.ts";
import { getMessage } from "../outreach/store.ts";
import { getRecord } from "../records.ts";
import { listDocuments } from "../vault.ts";
import { FIXTURE_DETAIL, type FIXTURE_PROFESSORS } from "./fixtures.ts";

export const ZONE: Record<string, string> = {
  "George Mason University": "America/New_York",
  "University of Illinois Chicago": "America/Chicago",
};

/**
 * draft_email's arguments for a first message to a fixture professor in the sheet: an email, or,
 * with no checked address but a LinkedIn profile, a note short enough for a connection request.
 */
export function firstDraft(db: Db, p: (typeof FIXTURE_PROFESSORS)[number] & { key: string }) {
  const last = p.name.split(" ").at(-1);
  const paper = recentTitles(p.recent)[0];
  const base = {
    name: p.name,
    university: p.university,
    touch: "first",
    timeZone: ZONE[p.university] ?? "America/New_York",
  };
  const record = getRecord(db, p.key);
  const note = record && !addressChecked(record.emailCheck) && "linkedin" in p && p.linkedin;
  if (note)
    return {
      ...base,
      channel: "linkedin",
      to: note,
      subject: "",
      body: `Dear Dr. ${last}, I read ${paper} and want to build on it. Are you taking a PhD student for Fall 2027?`,
    };
  const fact = profileFacts(db).find((f) => factStatus(f) === "confirmed");
  const cv = listDocuments(db).find((d) => d.kind === "cv");
  return {
    ...base,
    channel: "email",
    to: p.email ?? "",
    subject: p.contact.includes("PhD 2027") ? `PhD 2027: ${p.niche}` : `${p.niche}, PhD Fall 2027`,
    body: [
      `Dear Dr. ${last},`,
      `I read ${paper}. ${FIXTURE_DETAIL[p.name] ?? ""}`,
      fact ? `My background: ${fact.text} [[${fact.id}]].` : "",
      "Are you taking a PhD student for Fall 2027?",
      cv ? "My CV is attached." : "",
      "Best regards",
    ]
      .filter(Boolean)
      .join("\n\n"),
    attach: cv ? [cv.id] : [],
  };
}

/**
 * draft_email's arguments for a first message rebuilt around the applicant's own lines (an
 * [own-words] turn): their sentences with capitals fixed, each change listed with why, between
 * the greeting and the one question; and what the agent says after. args is null when the
 * draft is gone.
 */
export function ownWordsTurn(db: Db, text: string) {
  const args = ownWordsDraft(db, text);
  const fixed = args?.fixes.length ?? 0;
  return {
    args,
    said: args
      ? `Rewrote it around your lines: ${fixed} ${fixed === 1 ? "fix" : "fixes"}.`
      : "That draft is gone.",
  };
}

function ownWordsDraft(db: Db, text: string) {
  const m = getMessage(db, /message=(\S+)/.exec(text)?.[1] ?? "");
  const record = m && getRecord(db, m.recordKey);
  const words = /"""\n([\s\S]*?)\n"""/.exec(text)?.[1] ?? "";
  if (!m || !record || !words) return null;
  const fixes: { from: string; to: string; why: string }[] = [];
  const lines = words.split(/(?<=[.!?])\s+/).map((from) => {
    const to = from.replace(/\bi\b/g, "I").replace(/^\p{Ll}/u, (c) => c.toUpperCase());
    if (to !== from) fixes.push({ from, to, why: "capitals only" });
    return to;
  });
  return {
    name: record.name,
    university: record.university,
    channel: m.channel,
    touch: "first",
    to: m.to,
    subject: m.subject,
    body: `Dear Dr. ${record.name.split(" ").at(-1)},\n\n${lines.join(" ")}\n\nAre you taking a PhD student for Fall 2027?\n\nBest regards`,
    timeZone: m.timeZone,
    fixes,
  };
}
