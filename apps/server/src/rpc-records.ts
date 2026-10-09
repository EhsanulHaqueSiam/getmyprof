// The sheet and the money behind it: records (list, page, scholarly, Add PI, CSV) and the
// funding finder. rpc.ts spreads these into its handlers.
import type { Award, Position } from "@getmyprof/contracts";
import { exportCsv, importCsv } from "./adapters.ts";
import { positionKey, sourceKey } from "./agent/sourcing.ts";
import { getKv, setKv } from "./db.ts";
import { pageExtras, scholarly } from "./professor-page.ts";
import {
  getRecord,
  listRecords,
  personKey,
  professorFromAward,
  professorFromPosition,
  putRecord,
  recordKey,
  threadProposals,
} from "./records.ts";
import type { Handlers, Services } from "./rpc.ts";
import { intakeStart, monthsAfter, sameSchool, sourcesFor } from "./sources.ts";
import { daysLeft, positionSourcesFor } from "./sources-positions.ts";
import { getHunt } from "./state.ts";
import { getThread } from "./threads.ts";

type RecordMethods = Extract<keyof Handlers, `records.${string}` | `funding.${string}`>;

export function recordHandlers(svc: Services): Pick<Handlers, RecordMethods> {
  const { db, bus, sources } = svc;
  return {
    "records.list": () => listRecords(db),
    "records.get": ({ key }) => {
      const record = getRecord(db, key);
      if (!record) throw new Error(`No professor ${key}`);
      const threadIds = db
        .prepare("SELECT thread_id FROM thread_rows WHERE record_key = ?")
        .all(key)
        .map((r) => String(r.thread_id));
      const proposals = threadIds
        .flatMap((id) => threadProposals(db, id))
        .filter((p) => p.recordKey === key);
      return {
        record,
        threads: threadIds.flatMap((id) => getThread(db, id) ?? []),
        proposals,
        ...pageExtras(db, record, proposals),
      };
    },
    "records.scholarly": async ({ key }) => {
      const record = getRecord(db, key);
      if (!record) throw new Error(`No professor ${key}`);
      return scholarly(sources, record, intakeStart(getHunt(db)?.prefs.intake ?? ""));
    },
    "records.addFromAward": ({ award }) => {
      const record = professorFromAward(
        getRecord(db, recordKey(award.pi, award.university)),
        award,
      );
      putRecord(db, record);
      // One fewer award waiting for a look, if the sidebar counted it.
      if (award.fit > 0 && (award.monthsAfterIntake ?? 0) > 0 && !award.inSheet)
        setKv(db, "funding.waiting", Math.max(0, getKv(db, "funding.waiting", Number, 0) - 1));
      bus.push({ type: "changed", what: "records" });
      bus.push({ type: "changed", what: "state" });
      return { key: record.key };
    },
    "records.addFromPosition": ({ position }) => {
      if (!position.professor) throw new Error("This posting names no professor");
      const record = professorFromPosition(
        getRecord(db, recordKey(position.professor, position.university)),
        position,
      );
      putRecord(db, record);
      bus.push({ type: "changed", what: "records" });
      return { key: record.key };
    },
    "records.import": ({ csv }) => {
      const added = importCsv(db, csv);
      bus.push({ type: "changed", what: "records" });
      return { added };
    },
    "records.export": () => ({ csv: exportCsv(db) }),

    "funding.search": async ({ terms, universities, sources: picked }) => {
      const records = listRecords(db);
      const hunt = getHunt(db);
      const which = picked?.length ? picked : sourcesFor(hunt?.prefs.places ?? []);
      const start = intakeStart(hunt?.prefs.intake ?? "");
      const activeAfter = start?.toISOString().slice(0, 10);
      const base = { terms, ...(activeAfter ? { activeAfter } : {}) };
      // Named schools filter every source. By default the sheet's schools filter the US pair,
      // and the other databases search the topic everywhere: the sheet's schools are mostly US.
      const sheetSchools = [...new Set(records.map((r) => r.university))].slice(0, 8);
      const runs = which.flatMap((s) => {
        const schools = universities.length
          ? universities
          : s === "NSF" || s === "NIH"
            ? sheetSchools
            : [];
        return (schools.length ? schools : [undefined]).map((u) =>
          sources[sourceKey(s)]({ ...base, ...(u ? { university: u } : {}) }),
        );
      });
      const found = (await Promise.allSettled(runs)).flatMap((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      const unique = [...new Map(found.map((a) => [`${a.source}:${a.id}`, a])).values()];
      // ponytail: fit counts the hunt's fields named in the award's text; embeddings if it misleads.
      const words = [...(hunt?.prefs.fields ?? []), ...(hunt?.prefs.adjacent ?? []), ...terms]
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
      const awards = unique
        .map((a): Award => {
          const text = `${a.title} ${a.abstract}`.toLowerCase();
          return {
            ...a,
            monthsAfterIntake: monthsAfter(a.ends, start),
            inSheet:
              !!a.pi &&
              records.some(
                (r) =>
                  personKey(r.name) === personKey(a.pi) && sameSchool(r.university, a.university),
              ),
            fit: [...new Set(words)].filter((w) => text.includes(w)).length,
          };
        })
        // Off topic last; then by months left after the intake, then by fit.
        .toSorted(
          (a, b) =>
            Number(b.fit > 0) - Number(a.fit > 0) ||
            (b.monthsAfterIntake ?? -999) - (a.monthsAfterIntake ?? -999) ||
            b.fit - a.fit,
        );
      // The sidebar's count: on topic, still paying when you start, PI not in the sheet yet.
      setKv(
        db,
        "funding.waiting",
        awards.filter((a) => a.fit > 0 && (a.monthsAfterIntake ?? 0) > 0 && !a.inSheet && a.pi)
          .length,
      );
      bus.push({ type: "changed", what: "state" });
      return awards;
    },

    "funding.positions": async ({ terms, universities, sources: picked }) => {
      const records = listRecords(db);
      const hunt = getHunt(db);
      const which = picked?.length
        ? picked
        : positionSourcesFor(hunt?.prefs.places ?? [], hunt?.prefs.fields ?? []);
      const runs = which.flatMap((s) =>
        (universities.length ? universities : [undefined]).map((u) =>
          sources[positionKey(s)]({ terms, ...(u ? { university: u } : {}) }),
        ),
      );
      const found = (await Promise.allSettled(runs)).flatMap((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      const unique = [...new Map(found.map((p) => [`${p.source}:${p.id}`, p])).values()];
      const words = [...(hunt?.prefs.fields ?? []), ...(hunt?.prefs.adjacent ?? []), ...terms]
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
      return (
        unique
          .map((p): Position => {
            const text = `${p.title} ${p.abstract}`.toLowerCase();
            return {
              ...p,
              daysLeft: daysLeft(p.deadline),
              inSheet:
                !!p.professor &&
                records.some(
                  (r) =>
                    personKey(r.name) === personKey(p.professor) &&
                    sameSchool(r.university, p.university),
                ),
              fit: [...new Set(words)].filter((w) => text.includes(w)).length,
            };
          })
          // Closed last, off topic before them; then the soonest deadline, then fit.
          .toSorted(
            (a, b) =>
              Number((b.daysLeft ?? 0) >= 0) - Number((a.daysLeft ?? 0) >= 0) ||
              Number(b.fit > 0) - Number(a.fit > 0) ||
              (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) ||
              b.fit - a.fit,
          )
      );
    },
  };
}
