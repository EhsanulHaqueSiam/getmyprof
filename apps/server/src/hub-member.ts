// The student side: this install connected to a counselor's hub (kv `hub.member`). syncHub runs
// on connect, on "Sync now" and hourly from bin.ts: it sends the progress report, pulls the shared
// catalog when "Take" is on, and gives back public facts when "Give back" is on.
import {
  addressChecked,
  type HubCatalog as Catalog,
  HubCatalog,
  type HubStatus,
  type ProfessorField,
} from "@getmyprof/contracts";
import { z } from "zod";
import { type Db, getKv, newId, now, setKv } from "./db.ts";
import { publicFacts, readInvite } from "./hub.ts";
import { getRecord, propose, recordKey, threadProposals } from "./records.ts";
import { progressReport } from "./report.ts";
import { createThread, getThread, markUnread, putEvent, settle, setStatus } from "./threads.ts";
import { proposeFinding } from "./vault.ts";

const KEY = "hub.member";

const Member = z.object({
  url: z.string(),
  token: z.string(),
  name: z.string(),
  takeCatalog: z.boolean().default(true),
  /** Off until the student turns it on. */
  giveBack: z.boolean().default(false),
  lastSent: z.string().nullable().default(null),
  lastPulled: z.string().nullable().default(null),
  lastError: z.string().default(""),
});
type Member = z.infer<typeof Member>;

export const hubMember = (db: Db) => getKv(db, KEY, (v) => Member.nullable().parse(v), null);

export function hubStatus(db: Db): HubStatus {
  const m = hubMember(db);
  if (!m) return null;
  const { takeCatalog, giveBack, lastSent, lastPulled, lastError, name } = m;
  return {
    host: new URL(m.url).host,
    name,
    takeCatalog,
    giveBack,
    lastSent,
    lastPulled,
    lastError,
  };
}

/** Connects to the hub in an invite code, replacing any earlier one. */
export function connectHub(db: Db, code: string) {
  const invite = readInvite(code);
  setKv(db, KEY, Member.parse({ url: invite.u, token: invite.t, name: invite.n }));
}

export const disconnectHub = (db: Db) => setKv(db, KEY, null);

export function setMember(
  db: Db,
  patch: { takeCatalog?: boolean | undefined; giveBack?: boolean | undefined },
) {
  const m = hubMember(db);
  if (!m) throw new Error("Not connected to a hub.");
  setKv(db, KEY, {
    ...m,
    takeCatalog: patch.takeCatalog ?? m.takeCatalog,
    giveBack: patch.giveBack ?? m.giveBack,
  });
}

const keptThread = (db: Db) => getKv(db, "hub.thread", (v) => z.string().parse(v), "");

/** The one thread catalog changes to the sheet wait in, made the first time one is needed. */
function catalogThread(db: Db) {
  const kept = keptThread(db);
  const t = (kept && getThread(db, kept)) || createThread(db, "From the shared catalog");
  if (t.id !== kept) setKv(db, "hub.thread", t.id);
  return t.id;
}

const PUBLIC = ["email", "emailCheck", "website", "scholar", "recent", "taking"] as const;

/**
 * Takes in a pulled catalog. Programs and scholarships the Vault doesn't hold go to To file.
 * For professors already in the sheet, fields that differ go to Review in the catalog's thread;
 * an email only when its check passed. Professors not in the sheet are skipped, and a value
 * proposed there before (whatever came of it) isn't proposed again.
 */
export function applyCatalog(db: Db, catalog: Catalog) {
  let filed = 0;
  let threadId: string | null = null;
  let proposed = 0;
  for (const { fact, by } of catalog.facts) {
    if (fact.kind !== "professor") {
      const why = `From the shared catalog, checked by ${by}`;
      if ("id" in proposeFinding(db, { ...fact, why, threadId: null })) filed++;
      continue;
    }
    const { item } = fact;
    const record = getRecord(db, recordKey(item.name, item.university));
    if (!record) continue;
    const before = threadId ?? keptThread(db);
    const asked = before
      ? threadProposals(db, before)
          .filter((p) => p.recordKey === record.key)
          .flatMap((p) => p.changes)
      : [];
    const fields: { [F in ProfessorField]?: string } = {};
    for (const f of PUBLIC) {
      const to = item[f].trim();
      if ((f === "email" || f === "emailCheck") && !addressChecked(item.emailCheck)) continue;
      if (to && to !== record[f] && !asked.some((c) => c.field === f && c.to === to))
        fields[f] = to;
    }
    // A check is about one address: it goes alone only when that address is already theirs.
    if (fields.emailCheck && !fields.email && item.email.trim() !== record.email)
      delete fields.emailCheck;
    if (!Object.keys(fields).length) continue;
    threadId ??= catalogThread(db);
    const r = propose(db, threadId, {
      name: record.name,
      university: record.university,
      fields,
      sources: item.sources,
    });
    if ("proposal" in r) proposed++;
  }
  if (threadId && proposed) {
    putEvent(db, threadId, {
      id: newId("sys"),
      at: now(),
      type: "system",
      text: `${proposed} ${proposed === 1 ? "professor" : "professors"} from the shared catalog to review`,
    });
    // Back in the inbox, unread, even if it was settled.
    setStatus(db, threadId, "idle");
    settle(db, threadId, false);
    markUnread(db, threadId, true);
  }
  return { filed, proposed, threadId: proposed ? threadId : null };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const errorText = (e: unknown, host: string) =>
  e instanceof Error && e.name === "TimeoutError"
    ? `${host} didn't answer in 15 seconds.`
    : e instanceof TypeError
      ? `Can't reach ${host}.`
      : e instanceof z.ZodError
        ? `${host} sent a catalog this version can't read.`
        : e instanceof Error
          ? e.message
          : String(e);

/**
 * One sync with the hub. Never throws: a failure lands in lastError. Null when not connected.
 * `fetcher` is a test's way in; the real one is fetch.
 */
export async function syncHub(db: Db, fetcher: Fetch = fetch) {
  const m = hubMember(db);
  if (!m) return null;
  const host = new URL(m.url).host;
  const call = async (path: string, body?: unknown) => {
    const res = await fetcher(`${m.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${m.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) throw new Error(`${host} doesn't know this invite any more.`);
    if (!res.ok) throw new Error(`${host} answered ${res.status}.`);
    const data: unknown = await res.json();
    return data;
  };
  const patch: Partial<Member> = {};
  let applied: ReturnType<typeof applyCatalog> = { filed: 0, proposed: 0, threadId: null };
  try {
    await call("/api/hub/report", progressReport(db));
    patch.lastSent = now();
    if (m.takeCatalog) {
      applied = applyCatalog(db, HubCatalog.parse(await call("/api/hub/catalog")));
      patch.lastPulled = now();
    }
    if (m.giveBack) await call("/api/hub/facts", { facts: publicFacts(db) });
    patch.lastError = "";
  } catch (e) {
    patch.lastError = errorText(e, host).slice(0, 300);
  }
  // A disconnect or a toggle meanwhile stands: only this connection's sync fields change.
  const latest = hubMember(db);
  if (latest?.token === m.token) setKv(db, KEY, { ...latest, ...patch });
  return applied;
}
