import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { exportCsv, importCsv, importGradhunt, parseCsv } from "./adapters.ts";
import { openDb } from "./db.ts";
import {
  getRecord,
  putRecord,
  propose,
  recordKey,
  resolveProposal,
  scopeNote,
  threadRows,
} from "./records.ts";
import { addScope, createThread, getThread } from "./threads.ts";

const setup = () => {
  const db = openDb(":memory:");
  return { db, thread: createThread(db, "t").id };
};
const lybarger = {
  name: "Kevin Lybarger",
  university: "George Mason University",
  sources: ["https://example.edu"],
};

describe("proposals", () => {
  it("adds a new person, then proposes only the fields that change", () => {
    const { db, thread } = setup();
    const first = propose(db, thread, { ...lybarger, fields: { fit: 5, money: "NIH $4.65M" } });
    expect("proposal" in first && first.proposal.kind).toBe("add");
    const again = propose(db, thread, {
      ...lybarger,
      fields: { fit: 5, money: "NIH $4.65M", emailCheck: "ok" },
    });
    expect("proposal" in again && again.proposal.changes).toEqual([
      { field: "emailCheck", from: "", to: "ok" },
    ]);
    expect(propose(db, thread, { ...lybarger, fields: { fit: 5 } })).toEqual({
      skipped: "no change",
    });
  });

  it("writes accepted changes and shows pending ones as an overlay", () => {
    const { db, thread } = setup();
    const add = propose(db, thread, { ...lybarger, fields: { fit: 5 } });
    if (!("proposal" in add)) throw new Error("expected a proposal");
    expect(threadRows(db, thread)[0]?.fit).toBe(5);
    expect(getRecord(db, recordKey(lybarger.name, lybarger.university))).toBeNull();
    resolveProposal(db, add.proposal.id, "accept");
    expect(getRecord(db, add.proposal.recordKey)?.fit).toBe(5);
    expect(getRecord(db, add.proposal.recordKey)?.sources).toEqual(["https://example.edu"]);
  });

  it("never proposes a rejected person again", () => {
    const { db, thread } = setup();
    const add = propose(db, thread, { ...lybarger, fields: { fit: 4 } });
    if (!("proposal" in add)) throw new Error("expected a proposal");
    resolveProposal(db, add.proposal.id, "reject");
    expect(propose(db, thread, { ...lybarger, fields: { fit: 5 } })).toEqual({
      skipped: "excluded earlier: rejected in Review",
    });
    expect(resolveProposal(db, add.proposal.id, "accept")).toBeNull();
  });
});

describe("csv", () => {
  it("parses quoted cells with commas, quotes and newlines", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });

  it("round-trips the sheet through export and import", () => {
    const { db, thread } = setup();
    const add = propose(db, thread, {
      ...lybarger,
      fields: { fit: 5, contact: 'email, subject "PhD 2027"' },
    });
    if (!("proposal" in add)) throw new Error("expected a proposal");
    resolveProposal(db, add.proposal.id, "accept");
    const fresh = openDb(":memory:");
    expect(importCsv(fresh, exportCsv(db))).toBe(1);
    expect(getRecord(fresh, add.proposal.recordKey)?.contact).toBe('email, subject "PhD 2027"');
  });
});

describe("gradhunt's sheet", () => {
  it("brings Scholar links and recent work, filling only what getmyprof lacks", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-gradhunt-"));
    const data = NodePath.join(dir, "loopany/prof-scout/data");
    NodeFS.mkdirSync(data, { recursive: true });
    const row = (name: string, more: object) => ({ name, university: "GMU", ...more });
    const sheet = [
      row("A One", {
        scholar_url: "https://scholar.google.com/citations?user=a",
        recent_works: [
          { title: "Newest", year: 2026, link: "https://x" },
          { title: "Older", year: 2025 },
          { title: "Oldest", year: 2024 },
          { title: "Dropped", year: 2023 },
        ],
      }),
      row("B Two", { recent_works: ["Paper one (2026)", "Paper two (2025)"] }),
      row("C Three", { recent_works: "Paper (arXiv, 2025)" }),
    ];
    // oxlint-disable-next-line getmyprof/single-writer -- a throwaway gradhunt layout in a temp dir
    NodeFS.writeFileSync(NodePath.join(data, "professors.json"), JSON.stringify(sheet));
    const db = openDb(":memory:");
    expect(importGradhunt(db, dir)).toBe(3);
    const a = getRecord(db, recordKey("A One", "GMU"));
    expect(a?.scholar).toBe("https://scholar.google.com/citations?user=a");
    expect(a?.recent).toBe("2026 Newest; 2025 Older; 2024 Oldest");
    expect(getRecord(db, recordKey("B Two", "GMU"))?.recent).toBe(
      "Paper one (2026); Paper two (2025)",
    );
    expect(getRecord(db, recordKey("C Three", "GMU"))?.recent).toBe("Paper (arXiv, 2025)");

    // A row imported before these fields existed gets them; what getmyprof found stays.
    if (!a) throw new Error("expected A One");
    putRecord(db, { ...a, scholar: "", recent: "2026-09 Found by the agent" });
    expect(importGradhunt(db, dir)).toBe(0);
    expect(getRecord(db, a.key)).toMatchObject({
      scholar: "https://scholar.google.com/citations?user=a",
      recent: "2026-09 Found by the agent",
    });
  });
});

describe("a thread's scope", () => {
  it("takes each professor or school once, and tells the agent what the sheet already has", () => {
    const { db, thread } = setup();
    const added = propose(db, thread, { ...lybarger, fields: { money: "NIH $4.65M" } });
    if ("proposal" in added) resolveProposal(db, added.proposal.id, "accept");
    const key = recordKey(lybarger.name, lybarger.university);
    const prof = { kind: "professor" as const, key, name: "Kevin Lybarger" };
    const school = { kind: "school" as const, name: "George Mason University" };

    expect(addScope(db, thread, [prof, school, prof])).toEqual([prof, school]);
    expect(addScope(db, thread, [prof])).toEqual([]);
    expect(getThread(db, thread)?.scope).toEqual([prof, school]);

    const note = scopeNote(db, [prof, school, { kind: "school", name: "Purdue" }]);
    expect(note).toContain(`key ${key}`);
    expect(note).toContain("NIH $4.65M");
    expect(note).toContain("https://example.edu");
    expect(note).toContain("George Mason University, 1 in the sheet:");
    expect(note).toContain("Purdue: nobody in the sheet yet");
    expect(scopeNote(db, [])).toBe("");
  });
});

describe("evidence", () => {
  it("refuses a money tier of 1 or 2 without a page, and flags a value another page set", () => {
    const { db, thread } = setup();
    expect(
      propose(db, thread, { ...lybarger, sources: [], fields: { moneyTier: 2, money: "NIH" } }),
    ).toEqual({
      skipped: "a money tier of 1 or 2 needs the page that shows the money as a source",
    });

    const first = propose(db, thread, { ...lybarger, fields: { email: "k@gmu.edu" } });
    if ("proposal" in first) resolveProposal(db, first.proposal.id, "accept");
    const other = propose(db, thread, {
      ...lybarger,
      sources: ["https://directory.gmu.edu/kl"],
      fields: { email: "klybarger@gmu.edu" },
    });
    if (!("proposal" in other)) throw new Error("not proposed");
    expect(other.proposal.changes.find((c) => c.field === "email")?.disagrees).toMatch(
      /^example\.edu, /,
    );
  });
});
