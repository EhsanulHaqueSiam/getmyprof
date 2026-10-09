import { describe, expect, it } from "vite-plus/test";
import { Applicant, Professor } from "./domain.ts";
import { nextMoves } from "./moves.ts";
import { Application, Program, VaultDocument, type VaultState } from "./vault.ts";

const now = new Date(2026, 9, 9);
const vault = (over: Partial<VaultState>): VaultState => ({
  documents: [],
  scholarships: [],
  programs: [],
  applications: [],
  offers: [],
  writing: [],
  toFile: [],
  schools: [],
  ...over,
});
const uiuc = Program.parse({
  id: "uiuc",
  university: "UIUC",
  name: "PhD CS",
  degree: "phd",
  deadline: "2026-12-01",
  fee: "$90",
  waiver: "on request",
  english: "IELTS 7.0",
  funding: "",
  url: "https://uiuc.edu/phd",
  sources: [],
  note: "",
});
const applying = Application.parse({
  id: "app-uiuc",
  programId: "uiuc",
  status: "in-progress",
  waiver: "none",
  documents: [],
  recommenders: [{ name: "Dr. Rahman", email: "", status: "agreed" }],
  portal: "",
  portalStatus: "",
  professors: [],
  submittedAt: null,
  note: "",
});
const applicant = Applicant.parse({
  citizenship: ["Bangladesh"],
  residence: "Bangladesh",
  degreeYears: 4,
  gpa: "3.62",
  tests: [{ name: "IELTS", status: "taken", date: "2026-06-14", score: "6.5" }],
  moi: false,
  feeBudgetUsd: 50,
  dependents: false,
  minStipendUsd: null,
});
const professor = (name: string, over: Partial<Professor>) =>
  Professor.parse({
    key: name,
    name,
    university: "GMU",
    department: "",
    niche: "",
    fit: 5,
    moneyTier: 1,
    taking: "",
    money: "",
    lasts: "",
    email: "",
    emailCheck: "",
    contact: "",
    stage: "new",
    fitsBecause: "",
    website: "",
    sources: [],
    grants: [],
    origin: "app",
    updatedAt: "",
    ...over,
  });

describe("next moves", () => {
  it("rank what to do by date, each with its lane, why and where", () => {
    const moves = nextMoves(
      {
        vault: vault({ programs: [uiuc], applications: [applying] }),
        applicant,
        facts: [
          {
            id: "f1",
            text: "BSc CSE",
            source: "",
            kind: "education",
            date: "2025",
            confirmed: false,
            question: false,
            planned: false,
          },
        ],
        records: [
          professor("Kevin Lybarger", {}),
          // Contacted, not taking, or a weak fit: not a move.
          professor("Sent Already", { stage: "sent" }),
          professor("Full Lab", { taking: 'no: "not until 2028"' }),
          professor("Weak Fit", { fit: 2 }),
        ],
        conversations: [{ turn: "yours", record: professor("Mohan Zalake", {}) }],
      },
      now,
    );
    expect(moves.map((m) => [m.by, m.lane, m.title])).toEqual([
      ["2026-10-09", "Outreach", "Answer Mohan Zalake"],
      ["2026-10-09", "Profile", "Add your CV"],
      ["2026-10-12", "Outreach", "Email 1 professor who can fund you"],
      ["2026-10-12", "Profile", "Confirm 1 fact"],
      ["2026-10-16", "Money", "Fees are $40 over your budget"],
      ["2026-10-20", "Admission", "UIUC: ask your recommenders"],
      ["2026-11-10", "Money", "Ask UIUC for a fee waiver"],
      ["2026-12-01", "Admission", "UIUC: needs IELTS 7.0, you have 6.5"],
    ]);
    expect(moves.find((m) => m.lane === "Admission")?.to).toEqual({
      page: "vault",
      section: "applications",
    });
  });

  it("are empty when nothing waits", () => {
    expect(
      nextMoves(
        {
          vault: vault({
            documents: [
              VaultDocument.parse({
                id: "d1",
                name: "cv.pdf",
                kind: "cv",
                mime: "application/pdf",
                size: 1,
                expires: null,
                uploadedAt: "",
              }),
            ],
          }),
          applicant: undefined,
          facts: [],
          records: [],
          conversations: [],
        },
        now,
      ),
    ).toEqual([]);
  });
});
