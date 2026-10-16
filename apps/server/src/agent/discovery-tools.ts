// Faculty discovery beyond names: who CSRankings lists at a school, who at a school works on a
// topic by OpenAlex, and who has a PhD position advertised; and the sweep over everyone they
// surface (sweep.ts). Free; tools.ts spreads them into the hunt tools.
import { placeCountries, PositionSource } from "@getmyprof/contracts";
import { z } from "zod";
import { institutesFor } from "../institutes.ts";
import { positionKey } from "./sourcing.ts";
import { fieldVenues, papersIn, skip, surface, sweepNudge, unchecked } from "./sweep.ts";
import type { HuntTool } from "./tools.ts";

const define = <S extends z.ZodRawShape>(t: HuntTool<S>) => t;

export const DISCOVERY_TOOLS = [
  define({
    name: "sweep_status",
    description:
      "Who your award, CSRankings and topic searches surfaced in this thread and nobody has checked yet: not proposed, not in the sheet or Review, not skipped. A school is done when this is empty. Free.",
    shape: {},
    paid: false,
    price: () => 0,
    run: async (_args, ctx) => {
      const text = sweepNudge(ctx.db, ctx.threadId);
      return {
        summary: text ? `${unchecked(ctx.db, ctx.threadId).length} unchecked` : "sweep done",
        text: text ?? "Everyone surfaced has been checked.",
      };
    },
  }),
  define({
    name: "skip_candidates",
    description:
      "Pass on people the sweep surfaced who don't fit, each with the reason (another field, not faculty, retired, moved). Several at once. Free.",
    shape: {
      people: z
        .array(z.object({ name: z.string(), university: z.string(), why: z.string() }))
        .min(1),
    },
    paid: false,
    price: () => 0,
    run: async ({ people }, ctx) => {
      skip(ctx.db, ctx.threadId, people);
      const left = unchecked(ctx.db, ctx.threadId).length;
      return {
        summary: `${people.length} skipped`,
        text: `Skipped ${people.length}. ${left ? `${left} still unchecked: sweep_status lists them.` : "The sweep is done."}`,
      };
    },
  }),
  define({
    name: "institutes",
    description:
      "European research institutes with their own funded doctoral programmes (EMBL, Max Planck IMPRS, ISTA, CERN, ETH, EPFL, CNRS, CSIC...), with each one's application cycle, next dates, degree partner and page. Propose a fitting one with propose_school as kind institute, no rank, its cycle copied. Free.",
    shape: { fields: z.array(z.string()).describe("The fields to match; empty lists all") },
    paid: false,
    price: () => 0,
    run: async ({ fields }) => {
      const found = institutesFor(fields);
      return {
        summary: `${found.length} institutes`,
        text: found
          .map((i) => `- ${i.name} (${i.country}) | ${i.cycle} | degree: ${i.degree} | ${i.url}`)
          .join("\n"),
      };
    },
  }),
  define({
    name: "csrankings_faculty",
    description:
      "The computer science faculty CSRankings lists at one university, with homepage, Google Scholar link and the venues each published in over the last five years (acl, emnlp, naacl: NLP; icml, nips, iclr: ML; cvpr, iccv: vision...). Use it to sweep a department: anyone publishing in the applicant's fields or next to them is a candidate to read. Free.",
    shape: { university: z.string() },
    paid: false,
    price: () => 0,
    run: async ({ university }, ctx) => {
      const found = await ctx.sources.csrankings(university);
      const wanted = fieldVenues(ctx.hunt?.prefs);
      surface(
        ctx.db,
        ctx.threadId,
        found
          .filter((f) => papersIn(f.venues, wanted) >= 2)
          .map((f) => ({ name: f.name, university, via: `CSRankings ${f.venues}` })),
      );
      return {
        summary: `${found.length} faculty`,
        text: found.length
          ? found
              .slice(0, 80)
              .map(
                (f) =>
                  `- ${f.name} | ${f.venues || "no papers counted lately"} | ${f.homepage || "?"} | ${f.scholar || "no Scholar page"}`,
              )
              .join("\n")
          : `CSRankings lists nobody at ${university}; try its exact name, or the department's page.`,
      };
    },
  }),
  define({
    name: "openalex_by_topic",
    description:
      "Who at one university works on a topic, by OpenAlex: name, works, citations, top topics, most published first. Use it to find faculty by research area, not by name. Free.",
    shape: { topic: z.string(), university: z.string() },
    paid: false,
    price: () => 0,
    run: async ({ topic, university }, ctx) => {
      const found = await ctx.sources.byTopic(topic, university);
      // 30+ works: faculty, mostly, rather than students and postdocs.
      surface(
        ctx.db,
        ctx.threadId,
        found
          .filter((a) => a.works >= 30)
          .map((a) => ({ name: a.name, university, via: `OpenAlex ${topic}` })),
      );
      return {
        summary: `${found.length} authors`,
        text: found.length
          ? found
              .map(
                (a) =>
                  `- ${a.name} | ${a.works} works, ${a.citations} citations | ${a.topics.join("; ")} | ${a.link}`,
              )
              .join("\n")
          : `OpenAlex has no one at ${university} on "${topic}".`,
      };
    },
  }),
  define({
    name: "phd_positions",
    description:
      "Search advertised PhD positions by topic terms, optionally at one university: jobs.ac.uk (UK studentships), INSPIRE (physics worldwide; names the contact), DAAD (Germany; salaried posts, often naming the professor), AcademicTransfer (Netherlands; salaried), MUR (Italy's doctorate calls, scholarships; May to June season), EURAXESS (the newest doctoral posts in the hunt's other European countries). A posted, funded opening is money tier 1. Free.",
    shape: {
      source: PositionSource,
      terms: z.array(z.string()),
      university: z.string().optional(),
    },
    paid: false,
    price: () => 0,
    run: async ({ source, terms, university }, ctx) => {
      const found = await ctx.sources[positionKey(source)]({
        terms,
        countries: placeCountries(ctx.hunt?.prefs.places ?? []),
        ...(university ? { university } : {}),
      });
      const lines = found.map(
        (p) =>
          `${p.source} ${p.id} | ${p.professor || "no contact named"} | ${p.university}, ${p.country} | closes ${p.deadline ?? "?"} | ${p.funding || "funding not stated"} | ${p.title} | ${p.url}`,
      );
      return {
        summary: `${found.length} position${found.length === 1 ? "" : "s"} · free`,
        text: lines.join("\n") || "No open positions found.",
      };
    },
  }),
];
