import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createBus } from "./bus.ts";
import { openDb } from "./db.ts";
import { createOutreach } from "./outreach/service.ts";
import { blankProfessor, putRecord } from "./records.ts";
import {
  documentPath,
  numberCitations,
  proposeFinding,
  removeEntry,
  resolveFinding,
  saveDocument,
  saveWriting,
  startApplication,
  vaultState,
  writingBrief,
} from "./vault.ts";

const fulbright = {
  kind: "scholarship" as const,
  why: "open to Bangladeshi citizens",
  threadId: null,
  item: {
    name: "Fulbright Foreign Student Program",
    sponsor: "US Department of State",
    studyIn: "USA",
    citizenship: ["Bangladesh"],
    tracks: ["phd" as const],
    amount: "tuition, stipend",
    deadline: "2027-02-15",
    url: "https://example.org/fulbright",
    sources: ["https://example.org/fulbright"],
  },
};

const program = {
  kind: "program" as const,
  why: "advisors there",
  threadId: null,
  item: {
    university: "George Mason University",
    name: "PhD in Information Technology",
    degree: "phd" as const,
    deadline: "2026-12-01",
    fee: "$75",
    waiver: "on request",
    english: "IELTS 6.5",
    funding: "GRA/GTA",
    asks: "Your research interests\nWhy this program",
    limit: "2 pages",
    eligibility: "ok",
    url: "https://example.edu/phd-it",
    sources: ["https://example.edu/phd-it"],
  },
};

beforeEach(() => {
  process.env.GETMYPROF_HOME = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-vault-"));
});

describe("To file", () => {
  it("holds the agent's finds until a click, and a dismissed find never comes back", () => {
    const db = openDb(":memory:");
    const found = proposeFinding(db, fulbright);
    expect("id" in found).toBe(true);
    expect(proposeFinding(db, fulbright)).toEqual({ skipped: "already in the vault" });
    expect(vaultState(db).scholarships).toHaveLength(0);

    if ("id" in found) resolveFinding(db, found.id, "file");
    const s = vaultState(db);
    expect(s.toFile).toHaveLength(0);
    expect(s.scholarships[0]).toMatchObject({ name: fulbright.item.name, status: "watch" });
    expect(proposeFinding(db, fulbright)).toEqual({ skipped: "already in the vault" });

    const other = proposeFinding(db, program);
    if ("id" in other) resolveFinding(db, other.id, "dismiss");
    expect(proposeFinding(db, program)).toEqual({ skipped: "dismissed earlier" });
  });
});

describe("documents", () => {
  it("keeps the bytes readable by this user only, and removing one deletes them", () => {
    const db = openDb(":memory:");
    const doc = saveDocument(db, {
      name: "transcript.pdf",
      kind: "transcript",
      mime: "application/pdf",
      expires: null,
      base64: Buffer.from("%PDF-1.4 fake").toString("base64"),
    });
    expect(NodeFS.readFileSync(documentPath(doc.id), "utf8")).toBe("%PDF-1.4 fake");
    expect(NodeFS.statSync(documentPath(doc.id)).mode & 0o777).toBe(0o600);
    removeEntry(db, "document", doc.id);
    expect(NodeFS.existsSync(documentPath(doc.id))).toBe(false);
  });

  it("keeps one copy when the same file is added twice", () => {
    const db = openDb(":memory:");
    const add = (name: string) =>
      saveDocument(db, {
        name,
        kind: "cv",
        mime: "application/pdf",
        expires: null,
        base64: "JVBERi0=",
      });
    expect(add("cv.pdf").id).toBe(add("cv-again.pdf").id);
    expect(vaultState(db).documents).toHaveLength(1);
  });
});

describe("an application", () => {
  it("links the vault's documents, names professors already contacted there, and hands them to the agent on submit", () => {
    const db = openDb(":memory:");
    saveDocument(db, {
      name: "cv.pdf",
      kind: "cv",
      mime: "application/pdf",
      expires: null,
      base64: "AA==",
    });
    putRecord(db, {
      ...blankProfessor("Kevin Lybarger", "George Mason University"),
      email: "lybarger@example.edu",
      stage: "sent",
    });
    putRecord(db, { ...blankProfessor("Not Contacted", "George Mason University"), stage: "new" });
    const found = proposeFinding(db, program);
    if ("id" in found) resolveFinding(db, found.id, "file");
    const prog = vaultState(db).programs[0]!;

    const app = startApplication(db, prog.id);
    expect(startApplication(db, prog.id).id).toBe(app.id);
    expect(app.documents.find((d) => d.name === "CV")).toMatchObject({ done: true });
    expect(app.documents.find((d) => d.name === "Transcript")).toMatchObject({ done: false });
    expect(app.professors).toEqual(["kevin-lybarger@george-mason-university"]);

    const asked: string[] = [];
    createOutreach({
      db,
      bus: createBus(),
      runner: { send: (_t, text) => void asked.push(text) },
      mailerFor: () => {
        throw new Error("no mail in this test");
      },
    }).afterApplying(app, prog);
    expect(asked[0]).toMatch(/^\[after-applying\] app=/);
    expect(asked[0]).toContain("Kevin Lybarger | George Mason University");
  });
});

describe("the Writer", () => {
  it("numbers citations by first use, and a revision becomes the next draft of the same piece", () => {
    expect(numberCitations("BSc [[f_b]]. Paper [[f_p]]. Again [[f_b]].")).toEqual({
      body: "BSc [1]. Paper [2]. Again [1].",
      citations: { "1": "f_b", "2": "f_p" },
    });
    const db = openDb(":memory:");
    const base = {
      kind: "sop" as const,
      title: "SOP",
      programId: null,
      scholarshipId: null,
      threadId: null,
    };
    const first = saveWriting(db, { ...base, pieceId: null, text: "One [[f_b]]." });
    const second = saveWriting(db, { ...base, pieceId: first.id, text: "Two [[f_p]]." });
    expect(second).toMatchObject({ id: first.id, draft: 2, citations: { "1": "f_p" } });
    expect(second.history).toEqual([
      { draft: 1, body: "One [1].", citations: { "1": "f_b" }, at: first.updatedAt },
    ]);
    expect(vaultState(db).writing).toHaveLength(1);
  });

  it("briefs the agent with every fact's id and status, and tailors from the earlier piece", () => {
    const db = openDb(":memory:");
    const piece = saveWriting(db, {
      pieceId: null,
      kind: "sop",
      title: "SOP",
      programId: null,
      scholarshipId: null,
      threadId: null,
      text: "My degree [[f_b]].",
    });
    const facts = [
      {
        id: "f_b",
        text: "BSc 2025",
        source: "cv.pdf",
        kind: "education" as const,
        date: "2025",
        confirmed: true,
        question: false,
        planned: false,
      },
      {
        id: "f_t",
        text: "Led a team of five",
        source: "",
        kind: "work" as const,
        date: "",
        confirmed: true,
        question: false,
        planned: false,
      },
    ];
    const { text } = writingBrief(db, facts, {
      kind: "sop",
      programId: null,
      scholarshipId: null,
      basedOn: piece.id,
    });
    expect(text).toMatch(/^\[write\] kind=sop program=- scholarship=- revise=wri_/);
    expect(text).toContain("- [[f_b]] BSc 2025 (confirmed)");
    expect(text).toContain("- [[f_t]] Led a team of five (needs proof)");
    expect(text).toContain("My degree [[f_b]].");
    // Asking again for the same target, without naming the piece, still revises it.
    const again = writingBrief(db, facts, {
      kind: "sop",
      programId: null,
      scholarshipId: null,
      basedOn: null,
    });
    expect(again.text).toContain(`revise=${piece.id}`);
  });
});
