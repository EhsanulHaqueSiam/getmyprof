import { describe, expect, it } from "vite-plus/test";
import { Applicant } from "./domain.ts";
import { answerFor, answerSheet, type PortalField } from "./portal.ts";
import { Application, Program } from "./vault.ts";

const program = Program.parse({
  id: "gmu",
  university: "George Mason University",
  name: "PhD in Information Technology",
  degree: "phd",
  deadline: "2026-12-01",
  fee: "$75",
  waiver: "",
  english: "IELTS 6.5",
  funding: "",
  url: "https://gmu.edu/phd",
  sources: [],
  note: "",
});
const app = Application.parse({
  id: "app",
  programId: "gmu",
  status: "in-progress",
  waiver: "none",
  documents: [],
  recommenders: [{ name: "Dr. Rahman", email: "rahman@du.ac.bd", status: "agreed" }],
  portal: "https://apply.gmu.edu",
  portalStatus: "",
  professors: ["lybarger"],
  submittedAt: null,
  note: "",
  answers: [
    {
      label: "Why this program? (100 words)",
      value: "DF-RAG's diversity step...",
      source: "Writer",
    },
  ],
});
const sheet = answerSheet({
  app,
  program,
  applicant: Applicant.parse({
    citizenship: ["Bangladesh"],
    residence: "Bangladesh",
    degreeYears: 4,
    gpa: "3.62",
    gpaScale: "4.00",
    tests: [{ name: "IELTS", status: "taken", date: "2026-06-14", score: "7.0" }],
    moi: false,
    feeBudgetUsd: null,
    dependents: false,
    minStipendUsd: null,
  }),
  facts: [
    {
      id: "f",
      text: "BSc in Computer Science and Engineering, University of Dhaka, 2024",
      source: "transcript.pdf",
      kind: "education",
      date: "2024",
      confirmed: true,
      question: false,
      planned: false,
    },
  ],
  hunt: null,
  mail: { name: "Nadia Rahman Chowdhury", address: "nadia@example.com" },
  records: [{ key: "lybarger", name: "Kevin Lybarger" }],
  documents: [],
  writing: [],
});
const field = (label: string, kind: PortalField["kind"] = "text"): PortalField => ({
  key: label,
  label,
  kind,
  required: false,
  options: [],
  value: "",
});

describe("the answer sheet", () => {
  it("answers what the app knows, each with its source", () => {
    expect(sheet.map((a) => [a.label, a.value, a.source])).toEqual([
      ["Full name", "Nadia Rahman Chowdhury", "your mailbox"],
      ["First name", "Nadia Rahman", "your mailbox"],
      ["Last name", "Chowdhury", "your mailbox"],
      ["Email", "nadia@example.com", "your mailbox"],
      ["Citizenship", "Bangladesh", "your setup"],
      ["Country of residence", "Bangladesh", "your setup"],
      [
        "Degree",
        "BSc in Computer Science and Engineering, University of Dhaka, 2024",
        "transcript.pdf",
      ],
      ["GPA", "3.62", "your setup"],
      ["GPA scale", "4.00", "your setup"],
      ["IELTS score", "7.0", "your setup"],
      ["IELTS date", "2026-06-14", "your setup"],
      ["Program", "PhD in Information Technology", "https://gmu.edu/phd"],
      ["Faculty you'd work with", "Kevin Lybarger", "this application"],
      ["Recommender 1 name", "Dr. Rahman", "this application"],
      ["Recommender 1 email", "rahman@du.ac.bd", "this application"],
    ]);
  });
});

describe("a portal field's answer", () => {
  it("comes from the sheet by its label, or the agent's answer for that label", () => {
    expect(answerFor(field("Given name"), sheet, app.answers)).toEqual({
      value: "Nadia Rahman",
      source: "your mailbox",
    });
    expect(answerFor(field("Cumulative GPA"), sheet, app.answers)).toMatchObject({ value: "3.62" });
    expect(answerFor(field("IELTS Overall Band"), sheet, app.answers)).toMatchObject({
      value: "7.0",
    });
    expect(
      answerFor(field("why this program? (100 words)", "textarea"), sheet, app.answers),
    ).toEqual({
      value: "DF-RAG's diversity step...",
      source: "Writer",
    });
    expect(answerFor(field("Favourite colour"), sheet, app.answers)).toBeNull();
  });

  it("matches whole labels, and leaves questions and long answers to the agent", () => {
    expect(answerFor(field("Program *"), sheet, [])).toMatchObject({
      value: "PhD in Information Technology",
    });
    // "program" inside a question is not the Program field.
    expect(answerFor(field("Why this program? (100 words)", "textarea"), sheet, [])).toBeNull();
    expect(answerFor(field("Describe your research experience"), sheet, [])).toBeNull();
    expect(answerFor(field("Which program are you applying to?"), sheet, [])).toBeNull();
    expect(answerFor(field("Email of your recommender"), sheet, [])).toBeNull();
  });

  it("leaves files, passwords, payment and signatures to the applicant", () => {
    expect(answerFor(field("Transcript", "file"), sheet, [])).toEqual({
      yours: "upload it yourself",
    });
    expect(answerFor(field("Password", "password"), sheet, [])).toEqual({ yours: "yours to type" });
    expect(answerFor(field("Electronic signature"), sheet, [])).toEqual({
      yours: "sign, pay or certify yourself",
    });
    expect(answerFor(field("Card number"), sheet, [])).toMatchObject({ yours: expect.any(String) });
  });
});
