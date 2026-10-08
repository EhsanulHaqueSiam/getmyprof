// Faculty discovery beyond names: who CSRankings lists at a school, and who at a school works
// on a topic by OpenAlex. Free and read-only; tools.ts spreads them into the hunt tools.
import { z } from "zod";
import type { HuntTool } from "./tools.ts";

const define = <S extends z.ZodRawShape>(t: HuntTool<S>) => t;

export const DISCOVERY_TOOLS = [
  define({
    name: "csrankings_faculty",
    description:
      "The computer science faculty CSRankings lists at one university, with homepage and Google Scholar links. Use it to sweep a department before reading pages. Free.",
    shape: { university: z.string() },
    paid: false,
    price: () => 0,
    run: async ({ university }, ctx) => {
      const found = await ctx.sources.csrankings(university);
      return {
        summary: `${found.length} faculty`,
        text: found.length
          ? found
              .slice(0, 80)
              .map((f) => `- ${f.name} | ${f.homepage || "?"} | ${f.scholar || "no Scholar page"}`)
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
];
