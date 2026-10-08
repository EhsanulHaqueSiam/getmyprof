import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { openDb } from "./db.ts";
import { refreshVault, searchVault } from "./okf.ts";
import { blankProfessor, putRecord } from "./records.ts";
import { saveFacts } from "./state.ts";
import { saveDocument, saveEdit, startApplication } from "./vault.ts";

describe("the vault as an OKF bundle", () => {
  it("writes linked, typed notes to disk and finds a fact with its proof", () => {
    process.env.GETMYPROF_HOME = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-okf-"));
    const db = openDb(":memory:");
    saveDocument(db, {
      name: "ra-letter.pdf",
      kind: "letter",
      mime: "application/pdf",
      expires: null,
      base64: Buffer.from("%PDF ra letter").toString("base64"),
    });
    saveFacts(db, [
      {
        id: "f_ra",
        text: "Research assistant, NLP lab, led a team of five",
        source: "ra-letter.pdf",
        kind: "work",
        date: "2025-06",
        confirmed: true,
        question: false,
        planned: false,
      },
    ]);
    const prof = blankProfessor("Kevin Lybarger", "George Mason University");
    putRecord(db, prof);
    saveEdit(db, {
      kind: "program",
      value: {
        id: "prg_1",
        university: "George Mason University",
        name: "PhD in Information Technology",
        degree: "phd",
        deadline: "2026-12-01",
        fee: "",
        waiver: "",
        english: "",
        funding: "",
        asks: "",
        limit: "",
        eligibility: "",
        url: "",
        sources: [],
        note: "",
      },
    });
    saveEdit(db, {
      kind: "application",
      value: { ...startApplication(db, "prg_1"), professors: [prof.key] },
    });

    refreshVault(db);
    const dir = NodePath.join(process.env.GETMYPROF_HOME, "vault");
    const role = NodeFS.readdirSync(NodePath.join(dir, "facts/roles")).find(
      (f) => f !== "index.md",
    );
    const note = NodeFS.readFileSync(NodePath.join(dir, "facts/roles", role ?? ""), "utf8");
    expect(note).toMatch(
      /^---\ntype: Role\ntitle: "Research assistant, NLP lab, led a team of five"/,
    );
    expect(note).toContain('date: "2025-06"');
    expect(note).toMatch(
      /## Related\n- \[ra-letter\.pdf\]\(\.\.\/\.\.\/documents\/ra-letter-pdf-\w+\.md\)/,
    );
    expect(NodeFS.existsSync(NodePath.join(dir, "okf-base.yaml"))).toBe(true);

    const [hit] = searchVault(db, "team leadership lab");
    expect(hit).toMatchObject({ type: "Role" });
    expect(hit?.linked.map((l) => l.title)).toEqual(["ra-letter.pdf"]);
    const app = searchVault(db, "application information technology").find(
      (h) => h.type === "Application",
    );
    expect(app?.linked.map((l) => l.title).toSorted()).toEqual([
      "George Mason University · PhD in Information Technology",
      "Kevin Lybarger · George Mason University",
    ]);
  });
});
