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
      question: z
        .boolean()
        .describe(
          "True when the claim needs proof the CV doesn't give, e.g. 'fluent English' with no test",
        ),
    }),
  ),
});

const INSTRUCTIONS =
  "Read the applicant's CV and links and list the facts a funded-PhD application would rest on: degrees and dates, grades, papers (title, venue, year, author position), projects, work, tests and certificates, citizenship. One fact each. Never infer or improve a fact; copy what the document says. Mark a claim as a question when the document gives no proof for it.";

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
  const q = query({
    prompt: (async function* () {
      yield message;
    })(),
    options: {
      model,
      systemPrompt: INSTRUCTIONS,
      settingSources: [],
      tools: [],
      maxTurns: 2,
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
      question: f.question,
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
    confirmed: false,
    question: false,
  },
  {
    id: newId("fact"),
    text: "GPA 3.8 / 4.0",
    source: "CV p1",
    kind: "education",
    confirmed: false,
    question: false,
  },
  {
    id: newId("fact"),
    text: '"Fluent English": which test or certificate proves it?',
    source: "CV p2",
    kind: "test",
    confirmed: false,
    question: true,
  },
];
