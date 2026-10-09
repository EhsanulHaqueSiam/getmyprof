// Help with an application portal: the answer sheet (every field portals ask, filled from what
// the app knows, each with its source) and, in the desktop app, the fields read off the portal's
// own page matched to those answers. The student fills and submits; the app never pays, signs,
// uploads or presses Submit.
import { z } from "zod";
import {
  type Applicant,
  factStatus,
  type Hunt,
  type Professor,
  type ProfileFact,
} from "./domain.ts";
import type { Application, Program, VaultDocument, Writing } from "./vault.ts";

/** Tags the agent turn that answers portal fields (rpc applications.suggestAnswers, the fake agent). */
export const PORTAL_TAG = "[portal]";

/** One field on a portal page, as the desktop app reads it. `key` finds it again on that page. */
export const PortalField = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum([
    "text",
    "textarea",
    "select",
    "radio",
    "checkbox",
    "date",
    "email",
    "tel",
    "number",
    "url",
    "file",
    "password",
  ]),
  required: z.boolean(),
  /** A select's or a radio group's choices, as the page shows them. */
  options: z.array(z.string()),
  value: z.string(),
});
export type PortalField = z.infer<typeof PortalField>;

/** How each field went when the desktop app filled the page: done, or why not. */
export const PortalFilled = z.array(
  z.object({ key: z.string(), ok: z.boolean(), note: z.string() }),
);

/** An answer for a portal: the label portals use, the value, and where it comes from. */
export type SheetAnswer = {
  section: "You" | "Education" | "Tests" | "Program" | "Letters" | "Documents";
  label: string;
  value: string;
  source: string;
  /** Labels on a portal page this answers, e.g. /e-?mail/. */
  match: RegExp;
};

/**
 * Every answer the app can give a portal for this application, from the applicant's setup,
 * confirmed facts, tests, the application's recommenders and professors, the hunt and the Vault.
 * Nothing is guessed: what the app doesn't know isn't listed.
 */
export function answerSheet(ctx: {
  app: Application;
  program: Program;
  applicant: Applicant;
  facts: ProfileFact[];
  hunt: Hunt | null;
  /** The connected mailbox's name and address: who the applicant is to a portal. */
  mail: { name: string; address: string };
  records: Pick<Professor, "key" | "name">[];
  documents: VaultDocument[];
  writing: Writing[];
}): SheetAnswer[] {
  const { app, program, applicant, facts, hunt, mail } = ctx;
  const out: SheetAnswer[] = [];
  const add = (a: SheetAnswer) => {
    if (a.value.trim()) out.push(a);
  };
  const names = mail.name.trim().split(/\s+/);
  add({
    section: "You",
    label: "Full name",
    value: mail.name,
    source: "your mailbox",
    match: /^(full |legal )?name$/i,
  });
  if (names.length > 1) {
    add({
      section: "You",
      label: "First name",
      value: names.slice(0, -1).join(" "),
      source: "your mailbox",
      match: /first|given/i,
    });
    add({
      section: "You",
      label: "Last name",
      value: names.at(-1) ?? "",
      source: "your mailbox",
      match: /last|family|surname/i,
    });
  }
  add({
    section: "You",
    label: "Email",
    value: mail.address,
    source: "your mailbox",
    match: /e-?mail/i,
  });
  add({
    section: "You",
    label: "Citizenship",
    value: applicant.citizenship.join(", "),
    source: "your setup",
    match: /citizenship|nationality/i,
  });
  add({
    section: "You",
    label: "Country of residence",
    value: applicant.residence,
    source: "your setup",
    match: /residen/i,
  });

  for (const f of facts.filter((x) => x.kind === "education" && factStatus(x) === "confirmed"))
    add({
      section: "Education",
      label: "Degree",
      value: f.text,
      source: f.source,
      match: /degree|institution|university attended|school attended/i,
    });
  add({
    section: "Education",
    label: "GPA",
    value: applicant.gpa,
    source: "your setup",
    match: /\bgpa\b|grade point|cgpa/i,
  });
  add({
    section: "Education",
    label: "GPA scale",
    value: applicant.gpaScale,
    source: "your setup",
    match: /scale|out of|maximum/i,
  });

  for (const t of applicant.tests.filter((x) => x.status === "taken")) {
    const name = t.name.trim();
    add({
      section: "Tests",
      label: `${name} score`,
      value: t.score,
      source: "your setup",
      match: new RegExp(
        `\\b${name.replace(/[^\w]/g, "")}\\b.*(score|total|overall|band)|^${name.replace(/[^\w]/g, "")}$`,
        "i",
      ),
    });
    add({
      section: "Tests",
      label: `${name} date`,
      value: t.date,
      source: "your setup",
      match: new RegExp(`\\b${name.replace(/[^\w]/g, "")}\\b.*date`, "i"),
    });
  }

  add({
    section: "Program",
    label: "Program",
    value: program.name,
    source: program.url,
    match: /program|major|field of study/i,
  });
  add({
    section: "Program",
    label: "Term",
    value: hunt?.prefs.intake ?? "",
    source: "your hunt",
    match: /term|intake|entry|semester/i,
  });
  const people = app.professors.flatMap((k) => ctx.records.find((r) => r.key === k)?.name ?? []);
  add({
    section: "Program",
    label: "Faculty you'd work with",
    value: people.join(", "),
    source: "this application",
    match: /faculty|professor|advisor|supervisor/i,
  });

  app.recommenders.forEach((r, i) => {
    add({
      section: "Letters",
      label: `Recommender ${i + 1} name`,
      value: r.name,
      source: "this application",
      match: /^$/,
    });
    add({
      section: "Letters",
      label: `Recommender ${i + 1} email`,
      value: r.email,
      source: "this application",
      match: /^$/,
    });
  });

  const cv = ctx.documents.find((d) => d.kind === "cv");
  if (cv) add({ section: "Documents", label: "CV", value: cv.name, source: "Vault", match: /^$/ });
  for (const w of ctx.writing.filter((x) => x.programId === app.programId))
    add({
      section: "Documents",
      label: w.title,
      value: `${w.kind}, ${w.body.split(/\s+/).length} words`,
      source: "Writer",
      match: /^$/,
    });
  return out;
}

/**
 * What a portal field gets: the agent's answer for that label when there is one, then the first
 * sheet answer whose pattern fits the label, else nothing. Files, passwords and anything that
 * pays or signs are the applicant's to do.
 */
export function answerFor(
  field: PortalField,
  sheet: SheetAnswer[],
  agent: Application["answers"],
): { value: string; source: string } | { yours: string } | null {
  if (field.kind === "file") return { yours: "upload it yourself" };
  if (field.kind === "password") return { yours: "yours to type" };
  if (/sign|signature|card|payment|cvv|billing|captcha|certif(y|ication)/i.test(field.label))
    return { yours: "sign, pay or certify yourself" };
  const said = agent.find((a) => a.label.trim().toLowerCase() === field.label.trim().toLowerCase());
  if (said) return { value: said.value, source: said.source };
  const hit = sheet.find((a) => a.match.test(field.label));
  return hit ? { value: hit.value, source: hit.source } : null;
}
