import { Applicant, Hunt, ProfileFact, Settings, FREE_SOURCES } from "@getmyprof/contracts";
import * as NodeCrypto from "node:crypto";
import { z } from "zod";
import { type Db, getKv, newId, setKv } from "./db.ts";

export const DEFAULT_SETTINGS: Settings = {
  detail: "std",
  budget: { perThread: 0.5, perLoopRun: 0.5, perDay: 2, askOver: 0.01 },
  model: "claude-opus-5-5",
  treg: false,
  profileSource: "app",
  gradhunt: false,
  setupDone: false,
  mcpServers: [],
  mcpToken: "",
  freeSources: [...FREE_SOURCES],
  firstEmails: "own",
};

/** The saved settings. The MCP token is made the first time anyone asks, then kept. */
export function getSettings(db: Db): Settings {
  const s = getKv(
    db,
    "settings",
    (v) => Settings.parse({ ...DEFAULT_SETTINGS, ...Settings.partial().parse(v) }),
    DEFAULT_SETTINGS,
  );
  if (s.mcpToken) return s;
  const withToken = { ...s, mcpToken: NodeCrypto.randomBytes(24).toString("base64url") };
  setKv(db, "settings", withToken);
  return withToken;
}

/** Merges a patch into the saved settings; keys left undefined keep their value. */
export function updateSettings(db: Db, patch: { [K in keyof Settings]?: Settings[K] | undefined }) {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next = Settings.parse({ ...getSettings(db), ...defined });
  setKv(db, "settings", next);
  return next;
}

export const getHunt = (db: Db) => getKv(db, "hunt", (v) => Hunt.parse(v), null);

export function saveHunt(db: Db, name: string, prefs: Hunt["prefs"]) {
  const hunt: Hunt = { id: getHunt(db)?.id ?? newId("hunt"), name, prefs };
  setKv(db, "hunt", hunt);
  return hunt;
}

export const DEFAULT_APPLICANT: Applicant = {
  citizenship: [],
  residence: "",
  degreeYears: 4,
  gpa: "",
  gpaScale: "",
  tests: [],
  moi: false,
  feeBudgetUsd: null,
  dependents: false,
  minStipendUsd: null,
};

export const getApplicant = (db: Db) =>
  getKv(db, "applicant", (v) => Applicant.parse(v), DEFAULT_APPLICANT);

export function saveApplicant(db: Db, applicant: Applicant) {
  setKv(db, "applicant", applicant);
  return applicant;
}

export const getFacts = (db: Db) => getKv(db, "facts", (v) => z.array(ProfileFact).parse(v), []);

export function saveFacts(db: Db, facts: ProfileFact[]) {
  setKv(db, "facts", facts);
  return facts;
}
