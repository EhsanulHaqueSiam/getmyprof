import { describe, expect, it } from "vite-plus/test";
import { exportCsv, importCsv, parseCsv } from "./adapters.ts";
import { openDb } from "./db.ts";
import { getRecord, propose, recordKey, resolveProposal, threadRows } from "./records.ts";
import { createThread } from "./threads.ts";

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
