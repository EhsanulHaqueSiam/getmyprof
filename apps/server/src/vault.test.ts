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
  proposeFinding,
  removeEntry,
  resolveFinding,
  saveDocument,
  startApplication,
  vaultState,
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
    url: "https://example.edu/phd-it",
    sources: ["https://example.edu/phd-it"],
  },
};

beforeEach(() => {
  process.env.GRADCODE_HOME = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-vault-"));
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
