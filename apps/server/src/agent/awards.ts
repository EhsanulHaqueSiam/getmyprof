// NSF, NIH and other award lookups as the agent reads them: one block per PI, with the email the
// award lists and its co-PIs here; every PI surfaced for the sweep. The award tools and
// professor_dossier share it.
import { placeCountries } from "@getmyprof/contracts";
import { intakeStart, monthsAfter } from "../sources.ts";
import { personKey } from "../records.ts";
import type { sourceKey } from "./sourcing.ts";
import { surface } from "./sweep.ts";
import type { ToolContext } from "./tools.ts";

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", AUD: "A$" };
const money = (amount: number | null, currency = "USD") =>
  amount == null
    ? "?"
    : `${SYMBOL[currency] ?? `${currency} `}${Math.round(amount).toLocaleString("en-US")}`;

export const awardLines = async (
  ctx: ToolContext,
  which: ReturnType<typeof sourceKey>,
  args: { terms: string[]; university?: string | undefined; pi?: string | undefined },
) => {
  const start = intakeStart(ctx.hunt?.prefs.intake ?? "");
  const activeAfter = start?.toISOString().slice(0, 10);
  const q = {
    terms: args.terms,
    ...(args.university ? { university: args.university } : {}),
    ...(args.pi ? { pi: args.pi } : {}),
    ...(activeAfter ? { activeAfter } : {}),
    countries: placeCountries(ctx.hunt?.prefs.places ?? []),
  };
  const awards = await ctx.sources[which](q);
  surface(
    ctx.db,
    ctx.threadId,
    awards.flatMap((a) => [
      ...(a.pi ? [{ name: a.pi, university: a.university, via: `${a.source} ${a.id}` }] : []),
      ...(a.coPis ?? []).map((c) => ({
        name: c.name,
        university: a.university,
        via: `${a.source} ${a.id} co-PI`,
      })),
    ]),
  );
  // One block per PI: a lab's five awards read as one lead, with the email the award lists.
  const byPi = new Map<string, { pi: string; university: string; awards: typeof awards }>();
  for (const a of awards) {
    const who = `${a.pi ? personKey(a.pi) : a.id}@${a.university.toLowerCase()}`;
    const at = byPi.get(who) ?? { pi: a.pi, university: a.university, awards: [] };
    at.awards.push(a);
    byPi.set(who, at);
  }
  const blocks = [...byPi.values()].map((p) => {
    const email = p.awards.find((a) => a.piEmail)?.piEmail;
    return [
      `PI ${p.pi || "not listed"}${email ? ` <${email}> (from the award)` : ""} | ${p.university}`,
      ...p.awards.map(
        (a) =>
          `  ${a.funder ? `${a.funder} (${a.source})` : a.source} ${a.id} | ${money(a.amount, a.currency)} | ends ${a.ends ?? "?"} | ${monthsAfter(a.ends, start) ?? "?"} months after intake | ${a.title}${a.coPis?.length ? ` | co-PIs here: ${a.coPis.map((c) => `${c.name} <${c.email}>`).join(", ")}` : ""}`,
      ),
    ].join("\n");
  });
  return {
    summary: `${awards.length} award${awards.length === 1 ? "" : "s"}, ${byPi.size} PI${byPi.size === 1 ? "" : "s"} · free`,
    text: blocks.join("\n") || "No active awards found.",
  };
};
