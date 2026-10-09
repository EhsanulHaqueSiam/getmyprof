// The progress report from the store (report.get, and what a student's install sends its
// counselor's hub). buildReport in contracts decides what's in it and what never is.
import { buildReport } from "@getmyprof/contracts";
import type { Db } from "./db.ts";
import { listMessages } from "./outreach/store.ts";
import { listRecords } from "./records.ts";
import { getApplicant, getHunt } from "./state.ts";
import { vaultState } from "./vault.ts";

export const progressReport = (db: Db, now = new Date()) =>
  buildReport({
    hunt: getHunt(db),
    vault: vaultState(db),
    records: listRecords(db),
    messages: listMessages(db),
    applicant: getApplicant(db),
    now,
  });
