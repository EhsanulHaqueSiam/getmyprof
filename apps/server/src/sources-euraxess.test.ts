import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { euraxessPositions, parseEuraxess, parseEuraxessCountries } from "./sources-euraxess.ts";

const page = NodeFS.readFileSync(
  NodePath.join(import.meta.dirname, "__samples__", "euraxess-jobs.html"),
  "utf8",
);

describe("EURAXESS by country", () => {
  it("reads the country facet's ids by ISO code", () => {
    const ids = parseEuraxessCountries(page);
    expect(ids.get("at")).toBe("791");
    expect(ids.get("cz")).toBe("747");
  });

  it("reads a card's post, host, deadline and posting date; postdocs stay out", () => {
    const posts = parseEuraxess(page, "Sweden");
    expect(posts[0]).toMatchObject({
      source: "EURAXESS",
      id: "473151",
      title:
        "Doctoral research: from variability to validation: standardizing multi-omics of oral fluids for reproducible disease signatures",
      university: "Malmö University",
      country: "Sweden",
      deadline: "2026-11-15",
      posted: "2026-10-16",
      url: "https://euraxess.ec.europa.eu/jobs/473151",
    });
    expect(posts[0]?.abstract).toMatch(/^Chemistry\. Malmö University/);
    // The sample's second card is a postdoc.
    expect(posts.map((p) => p.id)).not.toContain("473152");
  });

  it("reads only the hunt's European countries without a board, each page once", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(page));
    const q = { terms: [], countries: ["us", "gb", "de", "at", "cz"] };
    await euraxessPositions(q);
    await euraxessPositions({ ...q, university: "Malmö University" });
    const asked = fetch.mock.calls.map(([url]) => String(url));
    // The country list, then three pages each for Austria (791) and Czechia (747), not repeated.
    expect(asked.filter((u) => u.includes("job_country"))).toHaveLength(6);
    expect(asked.some((u) => /job_country%3A(771|794)/.test(u))).toBe(false);
    fetch.mockRestore();
  });
});
