import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { exportAll, importAll } from "./backup.ts";
import { openDb } from "./db.ts";
import { blankProfessor, listRecords, putRecord } from "./records.ts";
import { createThread, listThreads } from "./threads.ts";
import { documentPath, saveDocument, vaultState } from "./vault.ts";

describe("a full backup", () => {
  it("survives export, wipe and import with nothing lost, files included", () => {
    process.env.GETMYPROF_HOME = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-backup-"));
    const db = openDb(":memory:");
    putRecord(db, blankProfessor("Kevin Lybarger", "George Mason University"));
    createThread(db, "Find professors");
    const doc = saveDocument(db, {
      name: "cv.pdf",
      kind: "cv",
      mime: "application/pdf",
      expires: null,
      base64: Buffer.from("%PDF-1.4 cv").toString("base64"),
    });
    const backup = JSON.parse(JSON.stringify(exportAll(db)));

    NodeFS.rmSync(documentPath(doc.id));
    const fresh = openDb(":memory:");
    const counts = importAll(fresh, backup);
    expect(counts.records).toBe(1);
    expect(listRecords(fresh).map((r) => r.name)).toEqual(["Kevin Lybarger"]);
    expect(listThreads(fresh).map((t) => t.title)).toEqual(["Find professors"]);
    expect(vaultState(fresh).documents[0]?.name).toBe("cv.pdf");
    expect(NodeFS.readFileSync(documentPath(doc.id), "utf8")).toBe("%PDF-1.4 cv");
  });

  it("refuses a file that isn't a getmyprof backup", () => {
    expect(() => importAll(openDb(":memory:"), { tables: {} })).toThrow();
  });
});
