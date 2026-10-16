import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseEuraxess, parseEuraxessCountries } from "./sources-euraxess.ts";

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
});
