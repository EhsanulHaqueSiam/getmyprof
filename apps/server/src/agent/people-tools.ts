// The people around a professor, by OpenAlex: who is in their lab, and what links the applicant
// to them; and what their own page tells prospective students. Free and read-only; tools.ts
// spreads them into the hunt tools. The data comes from sources-people.ts and contact-page.ts
// (fixtures under the fake provider).
import { factStatus } from "@getmyprof/contracts";
import { z } from "zod";
import { profileFacts } from "../adapters.ts";
import type { HuntTool } from "./tools.ts";

const define = <S extends z.ZodRawShape>(t: HuntTool<S>) => t;
const who = { name: z.string(), university: z.string() };

export const PEOPLE_TOOLS = [
  define({
    name: "lab_members",
    description:
      "Who is in a professor's lab, by OpenAlex: everyone on 2+ of their works in the last 5 years, with shared works, last shared year, institution and link, flagged likely student (at their school, first author on a shared work) or likely alumnus (last shared work 2+ years ago, elsewhere now). Use it for lab, and to find a student to ask. Free.",
    shape: who,
    paid: false,
    price: () => 0,
    run: async ({ name, university }, ctx) => {
      const lab = await ctx.sources.lab(name, university);
      if (!lab) return { summary: "not found", text: "No matching OpenAlex author." };
      const lines = lab.coAuthors.slice(0, 25).map((c) => {
        const role = c.student ? " | likely student" : c.alumnus ? " | likely alumnus" : "";
        return `- ${c.name} | ${c.shared} shared, last ${c.lastYear} | ${c.institution || "?"}${c.now ? ` (now ${c.now})` : ""}${role} | ${c.link}`;
      });
      return {
        summary: `${lab.coAuthors.length} co-authors`,
        text: `${lab.name}, ${lab.institution}: ${lab.works} works since ${lab.since}.\n${lines.join("\n") || "Nobody wrote with them twice."}`,
      };
    },
  }),
  define({
    name: "warm_paths",
    description:
      "What links the applicant to a professor, by OpenAlex: the applicant's confirmed papers give their co-authors, and any work a co-author wrote with the professor is a warm path. Says when the professor is a direct co-author, and when nothing connects. Free.",
    shape: who,
    paid: false,
    price: () => 0,
    run: async ({ name, university }, ctx) => {
      const papers = profileFacts(ctx.db)
        .filter((f) => f.kind === "paper" && factStatus(f) === "confirmed")
        .map((f) => f.text);
      if (!papers.length)
        return {
          summary: "no papers",
          text: "No confirmed paper facts to start from: warm is none found unless the applicant names a link.",
        };
      const warm = await ctx.sources.warm(name, university, papers);
      if (!warm) return { summary: "not found", text: "No matching OpenAlex author." };
      const lines = [
        `${warm.name}. Found ${warm.found.length} of your ${papers.length} papers on OpenAlex.`,
        ...warm.direct.map(
          (w) => `They are your direct co-author: ${w.title} (${w.year}) ${w.link}`,
        ),
        ...warm.paths.map(
          (p) => `Your co-author ${p.via} wrote with them: ${p.title} (${p.year}) ${p.link}`,
        ),
      ];
      const linked = warm.direct.length + warm.paths.length;
      return {
        summary: warm.direct.length
          ? "direct co-author"
          : linked
            ? `${linked} warm path${linked === 1 ? "" : "s"}`
            : "none found",
        text: linked
          ? lines.join("\n")
          : `${lines[0]}\nNothing on OpenAlex connects you or your co-authors to them.`,
      };
    },
  }),
  define({
    name: "read_contact_rule",
    description:
      "Read what a professor's homepage or lab page, and the prospective-students page it links to, tells prospective students, quoted and dated: whether they're taking students and from when, words the subject line must carry, a form to use instead of email, don't email, apply to the program first, and a CV ask. Free.",
    shape: { url: z.string().describe("Their homepage or lab page") },
    paid: false,
    price: () => 0,
    run: async ({ url }, ctx) => {
      const r = await ctx.sources.contactPage(url);
      const said = (label: string, quote: string | null) => (quote ? [`${label}: "${quote}"`] : []);
      const lines = [
        ...r.statements.map((q) => `Says: "${q}"`),
        ...(r.subject ? [`Subject must carry: "${r.subject}"`] : []),
        ...(r.form ? [`Form instead of email: ${r.form}`] : []),
        ...said("Don't email", r.noEmail),
        ...said("Apply first", r.applyFirst),
        ...said("Wants", r.cv),
      ];
      const where = `${r.urls.join(" and ")} on ${r.readOn}`;
      return {
        summary: r.taking ? `taking ${r.taking}` : lines.length ? "rules found" : "nothing said",
        text: lines.length
          ? `Read ${where}.\n${lines.join("\n")}`
          : `Nothing on ${where} speaks to prospective students: taking is not stated (their page, ${r.readOn}).`,
      };
    },
  }),
];
