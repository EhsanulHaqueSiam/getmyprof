import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { FactKind, type ProfileFact } from "@gradcode/contracts";
import { z } from "zod";
import { newId } from "../db.ts";

const Extracted = z.object({
  facts: z.array(
    z.object({
      text: z
        .string()
        .describe(
          "One fact, in the applicant's terms: a degree, grade, paper, project, test, citizenship",
        ),
      source: z.string().describe("Where it came from, e.g. 'CV p1' or a URL"),
      kind: FactKind.describe("education, paper, project, test, work, or other"),
      date: z
        .string()
        .describe(
          'When it happened, only as precise as the source says: "2025", "2025-05" or "2025-05-14"; for a span, its end (or start if ongoing). Empty if the source gives none',
        ),
      planned: z
        .boolean()
        .describe("True for something booked or planned but not done yet, e.g. a test date"),
      question: z
        .boolean()
        .describe(
          "True when the claim needs proof the CV doesn't give, e.g. 'fluent English' with no test",
        ),
    }),
  ),
});

const INSTRUCTIONS =
  "Read the applicant's CV and links and list the facts a funded-PhD application would rest on: degrees and dates, grades, papers (title, venue, year, author position), projects, work, tests and certificates, citizenship. One fact each. Fetch every link given, and every link printed in the CV itself (personal site, Scholar, GitHub, ORCID, LinkedIn), with WebFetch and cross-check it against the CV: a fact one source states and another contradicts becomes a question. Cite the link a fact came from as its source. Never infer or improve a fact; copy what the source says. Mark a claim as a question when nothing gives proof for it.";

/** Drafts profile facts from a CV (PDF and/or pasted text) and links. Every fact starts unconfirmed. */
export async function extractFacts(
  input: { text: string; links: string[]; pdfBase64?: string | undefined },
  model: string,
): Promise<ProfileFact[]> {
  const message: SDKUserMessage = {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...(input.pdfBase64
          ? [
              {
                type: "document" as const,
                source: {
                  type: "base64" as const,
                  media_type: "application/pdf" as const,
                  data: input.pdfBase64,
                },
              },
            ]
          : []),
        {
          type: "text" as const,
          text:
            [input.text, input.links.length ? `Links:\n${input.links.join("\n")}` : ""]
              .filter(Boolean)
              .join("\n\n") || "(no text)",
        },
      ],
    },
  };
  const fetches = input.links.length > 0 || !!input.pdfBase64;
  const q = query({
    prompt: (async function* () {
      yield message;
    })(),
    options: {
      model,
      systemPrompt: INSTRUCTIONS,
      settingSources: [],
      // WebFetch reads the links, given or printed in the CV; nothing else, and nothing that writes.
      tools: fetches ? ["WebFetch"] : [],
      allowedTools: fetches ? ["WebFetch"] : [],
      maxTurns: fetches ? 6 + input.links.length * 2 : 2,
      outputFormat: { type: "json_schema", schema: z.toJSONSchema(Extracted) },
    },
  });
  for await (const m of q) {
    if (m.type !== "result") continue;
    if (m.subtype !== "success") throw new Error(`fact extraction ended: ${m.subtype}`);
    const parsed = Extracted.parse(m.structured_output ?? JSON.parse(m.result));
    return parsed.facts.map((f) => ({
      id: newId("fact"),
      text: f.text,
      source: f.source,
      kind: f.kind,
      date: f.date,
      question: f.question,
      planned: f.planned,
      confirmed: false,
    }));
  }
  return [];
}

/** What the fake provider returns, so first-run e2e runs without Claude. */
export const fakeFacts = (): ProfileFact[] => [
  {
    id: newId("fact"),
    text: "BSc in Computer Science, 2025",
    source: "CV p1",
    kind: "education",
    date: "2025",
    confirmed: false,
    question: false,
    planned: false,
  },
  {
    id: newId("fact"),
    text: "GPA 3.8 / 4.0",
    source: "CV p1",
    kind: "education",
    date: "2025",
    confirmed: false,
    question: false,
    planned: false,
  },
  {
    id: newId("fact"),
    text: '"Fluent English": which test or certificate proves it?',
    source: "CV p2",
    kind: "test",
    date: "",
    confirmed: false,
    question: true,
    planned: false,
  },
];
