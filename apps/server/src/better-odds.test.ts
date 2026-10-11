import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { betterOdds } from "./better-odds.ts";
import { realSources } from "./agent/sourcing.ts";

const GMU = "George Mason University";
const nih = (pi: string, activity = "R01") => ({
  project_num: `1${activity}LM0${pi.length}${Math.random().toString().slice(2, 6)}-01`,
  project_title: `${pi}'s project`,
  contact_pi_name: pi,
  organization: { org_name: "GEORGE MASON UNIVERSITY" },
  activity_code: activity,
  award_amount: 1_000_000,
});

describe("fields with better odds", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ranks neighbors by funded PIs the applicant can hold, citizen-only training grants apart", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).includes("nsf.gov")) return Response.json({ response: { award: [] } });
      const text = String(init?.body);
      const results = text.includes("health informatics")
        ? [nih("SMITH, ADA"), nih("JONES, BO"), nih("LEE, CY")]
        : text.includes("biomedical informatics")
          ? [nih("KIM, DEE"), nih("PARK, EVE", "T32")]
          : text.includes("natural language")
            ? [nih("ZHU, FAY")]
            : [];
      return Response.json({ results });
    });
    const odds = await betterOdds(realSources, ["clinical NLP"], [GMU], "2027-09-01");
    expect(odds.core).toBe(1);
    expect(odds.fields[0]).toMatchObject({ field: "Health informatics", fundedPis: 3 });
    expect(odds.fields.find((f) => f.field === "Biomedical informatics")).toMatchObject({
      fundedPis: 1,
      citizenOnly: 1,
    });
  });
});
