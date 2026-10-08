// LinkedIn's message box needs the member's id (ACoAA...), which only LinkedIn's own pages and
// APIs carry, never the public profile URL. One paid treg lookup reads it from the profile, once
// per professor (kept in kv); without paid lookups, or past today's cap or the ask-above line,
// "Copy and open LinkedIn" opens their profile instead, as before.
import type { Sources } from "../agent/sourcing.ts";
import { type Db, getKv, setKv } from "../db.ts";
import { getSettings } from "../state.ts";
import { daySpend, recordSpend } from "../threads.ts";
import { TREG_ENDPOINTS } from "../treg.ts";
import { z } from "zod";

const LOOKUP = "fetchinio.linkedin.user.profile";
const kept = (key: string) => `linkedin.member.${key}`;

/** The compose link LinkedIn's own Message button on a profile uses. */
const messageBox = (id: string) =>
  `https://www.linkedin.com/messaging/compose/?profileUrn=${encodeURIComponent(`urn:li:fsd_profile:${id}`)}&recipient=${id}`;

/** Where the note opens: their message box when the member id is known or can be bought. */
export async function linkedinOpen(db: Db, sources: Sources, recordKey: string, profile: string) {
  const known = getKv(db, kept(recordKey), (v) => z.string().parse(v), "");
  if (known) return { url: messageBox(known), note: "" };
  const s = getSettings(db);
  const spec = TREG_ENDPOINTS[LOOKUP];
  const fallback = (note: string) => ({ url: profile, note });
  if (!s.treg || !spec) return fallback("");
  if (spec.usd > s.budget.askOver)
    return fallback(`Finding their message box costs $${spec.usd}, above your ask line.`);
  if (daySpend(db) + spec.usd > s.budget.perDay)
    return fallback("Today's cap is used up, so this opens their profile.");
  const out = await sources.treg({
    endpoint: LOOKUP,
    data: { profileUrlOrUrn: profile },
    maxUsd: spec.max,
    tags: { thread: "", feature: "linkedin" },
  });
  if (out.costUsd > 0 || out.callId)
    recordSpend(db, {
      threadId: null,
      what: LOOKUP,
      usd: out.costUsd,
      callId: out.callId,
      feature: "linkedin",
      subject: recordKey,
    });
  if (!out.ok) return fallback(out.reason);
  // The id as a field (profileId) or inside the profile's URN, whichever the provider sends.
  const id = /(?:"profileId":"|fsd_profile:)(ACo[\w-]+)/.exec(JSON.stringify(out.result))?.[1];
  if (!id) return fallback("LinkedIn didn't say who this is, so this opens their profile.");
  setKv(db, kept(recordKey), id);
  return { url: messageBox(id), note: "" };
}
