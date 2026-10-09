// What propose_professor may set, as the agent reads it: each field of a professor row with how
// to fill it. tools.ts uses it as the tool's input shape.
import { Stage } from "@getmyprof/contracts";
import { z } from "zod";

export const professorFields = {
  name: z.string().describe("Full name as written on their own page"),
  university: z.string().describe("University name"),
  department: z.string().optional(),
  niche: z.string().optional().describe("Their area and the topics they work on now"),
  fit: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe("0-5 fit for this applicant, weighed by their priorities"),
  moneyTier: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe(
      "Money evidence tier: 1 clear (posted funded opening), 2 strong (active grant past the intake, new-hire startup, program funds every admit), 3 indirect (lab growing, gifts, students graduating), 4 none found",
    ),
  eligibility: z
    .string()
    .optional()
    .describe(
      '"ok", or "no: <why>" when this applicant cannot be paid here (citizenship-only funding, degree length)',
    ),
  taking: z
    .string()
    .optional()
    .describe(
      'Are they taking students for the intake? "yes", "no" or "not stated", then their words in quotes with where and when you read them, e.g. no: "not taking new PhD students until Fall 2028" (their page, 2026-10-09)',
    ),
  money: z.string().optional().describe("Their active funding, e.g. 'NSF CAREER $599,956'"),
  lasts: z
    .string()
    .optional()
    .describe("How long that money lasts, e.g. 'to May 2030' or 'not posted'"),
  email: z.string().optional().describe("Only an address printed on an official page"),
  emailCheck: z.string().optional().describe("ok, bounces, catch-all or unchecked"),
  contact: z
    .string()
    .optional()
    .describe("How they want to be reached, in their words, e.g. 'apply-only', or the form to use"),
  subjectRule: z
    .string()
    .optional()
    .describe(
      "The exact words their page says a first email's subject must carry, e.g. 'PhD 2027'",
    ),
  stage: Stage.optional(),
  fitsBecause: z
    .string()
    .optional()
    .describe("Why they fit this applicant, citing a confirmed fact"),
  website: z.string().optional(),
  sources: z.array(z.string()).min(1).describe("URLs backing every value you set"),
  linkedin: z
    .string()
    .optional()
    .describe(
      "Their LinkedIn profile URL (https://www.linkedin.com/in/...), only when their own page links it or a search shows it is them",
    ),
  scholar: z.string().optional().describe("Their Google Scholar profile URL"),
  recent: z.string().optional().describe("Latest 2 or 3 papers or projects, newest first, dated"),
  seeking: z.string().optional().describe("What they want in a student, in their words"),
  lab: z
    .string()
    .optional()
    .describe("Who is in the lab now, recent graduates and where they went, who to ask"),
  warm: z
    .string()
    .optional()
    .describe('A true path to them with its paper or event, or "none found"'),
  hook: z.string().optional().describe("One line tying the applicant's work to one of theirs"),
};
