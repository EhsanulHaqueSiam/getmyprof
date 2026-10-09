import { describe, expect, it } from "vite-plus/test";
import { stripCitations, uncitedClaims } from "./domain.ts";
import { draftIssues } from "./outreach.ts";

const fact = (id: string, source: string) => ({
  id,
  text: id,
  source,
  kind: "other" as const,
  date: "",
  confirmed: true,
  question: false,
  planned: false,
});
const facts = [fact("f_team", "cv.pdf"), fact("f_award", "")];

describe("claims about the applicant", () => {
  it("flags what you did or earned without a citation, not questions or plans", () => {
    expect(
      uncitedClaims(
        "I'm applying for a funded PhD for Fall 2027. I led a team of five. My CGPA is 3.71. I published two papers [1]. Are you taking students?",
      ),
    ).toEqual(["I led a team of five.", "My CGPA is 3.71."]);
    expect(stripCitations("I published two papers [1]. It was fun [2].")).toBe(
      "I published two papers. It was fun.",
    );
  });
});

describe("draft issues", () => {
  // Personal enough to pass: their name, their paper by title and one detail, one question.
  const opening =
    "Dear Dr. Lybarger,\n\nYour DF-RAG paper picks passages per query: query-aware diversity, not a fixed top-k.";
  const draft = {
    channel: "email" as const,
    touch: "first" as const,
    subject: "Clinical RAG PhD, Fall 2027",
    body: `${opening} I led a team of five [1]. I won a national award [2].`,
    citations: { "1": "f_team", "2": "f_award" },
  };
  const record = {
    emailCheck: "ok, on the lab page",
    recent:
      "2026-05 DF-RAG: Query-Aware Diversity for Retrieval-Augmented Generation (ACL); 2025 Clinical IE",
    hook: "",
    subjectRule: "",
  };
  const ctx = { facts, applicant: undefined, record };

  it("blocks a claim whose fact has no proof, a third link and an unchecked address", () => {
    expect(draftIssues(draft, ctx)).toEqual(["[2] cites a fact without proof"]);
    expect(
      draftIssues(
        { ...draft, body: `${opening} See https://a.org https://b.org https://c.org [1].` },
        { ...ctx, record: { ...record, emailCheck: "" } },
      ),
    ).toEqual(["more than two links", "the address isn't checked yet: run Find and check emails"]);
  });

  it("keeps a first LinkedIn note short enough for a connection request, with no address to check", () => {
    const note = {
      ...draft,
      channel: "linkedin" as const,
      body: "I led a team of five [1]. Are you taking students?",
    };
    const unchecked = { ...ctx, record: { ...record, emailCheck: "" } };
    expect(draftIssues(note, unchecked)).toEqual([]);
    expect(
      draftIssues({ ...note, body: `${"Are you taking students? ".repeat(9)}[1]` }, ctx),
    ).toEqual(["a first LinkedIn note over 200 characters won't fit a connection request"]);
    // Once connected, a follow-up message can run longer.
    expect(
      draftIssues(
        { ...note, touch: "follow-up-1", body: "Are you taking students? ".repeat(9) },
        ctx,
      ),
    ).toEqual([]);
  });

  it("lets a reply go to the address that wrote, and passes a clean draft", () => {
    const clean = {
      ...draft,
      body: `${opening} I led a team of five [1]. Are you taking students?`,
    };
    expect(draftIssues(clean, ctx)).toEqual([]);
    expect(
      draftIssues(
        { ...clean, touch: "reply", subject: "", body: "Thanks!" },
        { ...ctx, record: undefined },
      ),
    ).toEqual([]);
  });
});

describe("a first message written for one professor", () => {
  const record = {
    emailCheck: "ok",
    recent: "2026 DF-RAG: Query-Aware Diversity for Retrieval-Augmented Generation (ACL)",
    hook: "",
    subjectRule: "",
  };
  const ctx = { facts, applicant: undefined, record };
  const email = (body: string, subject = "Clinical RAG PhD, Fall 2027") =>
    draftIssues({ channel: "email", touch: "first", subject, body, citations: {} }, ctx);
  const named = "I read DF-RAG: Query-Aware Diversity for Retrieval-Augmented Generation.";

  it("opens on their name, not a generic salutation, on email and LinkedIn alike", () => {
    const generic = 'generic salutation: write "Dear Professor <Surname>" or "Dr. <Surname>"';
    for (const opener of [
      "Dear Sir/Madam,",
      "Respected Sir,",
      "To whom it may concern,",
      "Dear Professor,",
      "Dear Dr.\n",
    ])
      expect(email(`${opener}\n${named}`)).toEqual([generic]);
    expect(email(`Dear Professor Lybarger,\n${named}`)).toEqual([]);
    expect(email(`Dear Sirisha Rao,\n${named}`)).toEqual([]);
    const note = {
      channel: "linkedin" as const,
      touch: "first" as const,
      subject: "",
      citations: {},
    };
    expect(draftIssues({ ...note, body: "Dear Sir, are you taking students?" }, ctx)).toEqual([
      generic,
    ]);
    // Replies and follow-ups answer someone who knows the applicant already.
    expect(
      draftIssues({ ...note, touch: "follow-up-1", body: "Dear Sir, a short follow-up." }, ctx),
    ).toEqual([]);
  });

  it("names each generic line, so it can be replaced with something about their work", () => {
    expect(
      email(
        `Dear Dr. Lybarger,\nGreetings of the day. I read your papers and find your research fascinating, and would love to join your esteemed lab. ${named} I am a highly motivated, hardworking student.`,
      ),
    ).toEqual([
      'generic: "find your research fascinating": say what in their work, specifically',
      'generic: "your esteemed lab": say what in their work, specifically',
      'generic: "Greetings of the day": say what in their work, specifically',
      'generic: "highly motivated": say what in their work, specifically',
      'generic: "hardworking": say what in their work, specifically',
    ]);
  });

  it("keeps an email under about 150 words, citation markers aside", () => {
    expect(email(`${named} ${"word ".repeat(173)}`)).toEqual([
      "181 words: keep a first email under 150",
    ]);
    // 143 words once the markers go: under the limit.
    expect(email(`${named} ${"word [1] ".repeat(135)}`)).toEqual(["[1] points at no fact"]);
  });

  it("wants a short subject that names the topic and intake", () => {
    expect(email(named, "")).toEqual(["no subject: name the topic and intake in 3 to 7 words"]);
    for (const subject of [
      "PhD inquiry",
      "Prospective student",
      "Request for Ph.D. admission, Fall 2027",
    ])
      expect(email(named, subject)).toEqual([
        "a generic subject: name the topic and intake in 3 to 7 words",
      ]);
    expect(email(named, "word ".repeat(13))).toEqual([
      "a 13-word subject: name the topic and intake in 3 to 7 words",
    ]);
    expect(email(named, "PhD 2027: query-aware RAG")).toEqual([]);
  });

  it("names one of their papers by title: 3 of its words in a row, or a quote", () => {
    expect(
      draftIssues(
        {
          channel: "email",
          touch: "first",
          subject: "Clinical RAG, Fall 2027",
          body: named,
          citations: {},
        },
        { ...ctx, record: { ...record, recent: "" } },
      ),
    ).toEqual(["nothing of theirs on file to name: run Recent work and focus first"]);
    expect(email("Your work on retrieval is close to mine.")).toEqual([
      "doesn't name a paper of theirs: cite one recent work by title",
    ]);
    // Case, hyphens and filler words don't matter.
    expect(email("Your query-aware DIVERSITY in retrieval paper made me rethink top-k.")).toEqual(
      [],
    );
    expect(email('Your "Small models for long clinical notes" talk was clear.')).toEqual([]);
    // The hook names a work too.
    const hook = "Your notes project and their redundant passage pruning share a goal";
    expect(
      draftIssues(
        {
          channel: "email",
          touch: "first",
          subject: "Clinical RAG, Fall 2027",
          citations: {},
          body: "Your redundant passage pruning is what I need.",
        },
        { ...ctx, record: { ...record, recent: "", hook } },
      ),
    ).toEqual([]);
  });

  it("carries the words their page asks for in a first email's subject", () => {
    const first = (subject: string) =>
      draftIssues(
        {
          channel: "email",
          touch: "first",
          subject,
          citations: {},
          body: "Your query-aware diversity in retrieval paper made me rethink top-k.",
        },
        { ...ctx, record: { ...record, subjectRule: "PhD 2027" } },
      );
    expect(first("Clinical RAG, Fall 2027")).toEqual([
      'their page asks for "PhD 2027" in the subject',
    ]);
    expect(first("phd 2027: clinical RAG")).toEqual([]);
  });
});
