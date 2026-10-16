import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  daysLeft,
  parseAcademicTransfer,
  parseDaad,
  parseInspire,
  parseJobsAcUk,
  parseMur,
  payKind,
  positionSourcesFor,
  shortDate,
} from "./sources-positions.ts";

const sample = (name: string) =>
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "__samples__", name), "utf8");

describe("jobs.ac.uk search rows", () => {
  const today = new Date("2026-10-09T12:00:00Z");
  it("keep studentships with their funding line and dates", () => {
    const [row] = parseJobsAcUk(sample("jobsacuk-search.html"), today);
    expect(row).toMatchObject({
      source: "jobs.ac.uk",
      id: "1083400",
      title: "PhD Studentship: Machine-learning for High-speed Aerial Vehicle Control",
      university: "University of Bristol",
      country: "United Kingdom",
      funding: "Funding: fully funded. Standard EPSRC stipend",
      deadline: "2026-11-04",
      posted: "2026-08-04",
      url: "https://www.jobs.ac.uk/job/DSK809/phd-studentship-machine-learning-for-high-speed-aerial-vehicle-control",
    });
  });

  it("drop postdoc rows", () => {
    const row = sample("jobsacuk-search.html").replace(
      "PhD Studentship: Machine-learning",
      "Postdoctoral Research Assistant in Machine-learning",
    );
    expect(parseJobsAcUk(row, today)).toEqual([]);
  });

  it("put a closing date in the year it comes next, a placed date in the year it last came", () => {
    expect(shortDate("04 Nov", today, true)).toBe("2026-11-04");
    expect(shortDate("15 Jan", today, true)).toBe("2027-01-15");
    expect(shortDate("09 Oct", today, true)).toBe("2026-10-09");
    expect(shortDate("17 Sep", today, false)).toBe("2026-09-17");
    expect(shortDate("20 Dec", today, false)).toBe("2025-12-20");
  });
});

describe("INSPIRE jobs", () => {
  it("name the contact in sheet order and the host", () => {
    const [p] = parseInspire({
      hits: {
        hits: [
          {
            created: "2026-10-07T11:55:49Z",
            metadata: {
              control_number: 3212337,
              position: "Nuclear Fragmentation Measurements for Cosmic Rays",
              institutions: [{ value: "LPSC, Grenoble" }],
              contact_details: [{ name: "Maurin, David Alain" }],
              regions: ["Europe"],
              deadline_date: "2026-11-02",
              description: "<div><strong>PhD Position</strong> in astroparticle physics</div>",
            },
          },
        ],
      },
    });
    expect(p).toMatchObject({
      source: "INSPIRE",
      id: "3212337",
      professor: "David Alain Maurin",
      university: "LPSC, Grenoble",
      country: "Europe",
      deadline: "2026-11-02",
      posted: "2026-10-07",
      abstract: "PhD Position in astroparticle physics",
      url: "https://inspirehep.net/jobs/3212337",
    });
  });
});

describe("DAAD's PhDGermany feed", () => {
  it("reads the pay line, the supervisor and both dates from each item", () => {
    const [row] = parseDaad(sample("daad-phd.xml"));
    expect(row).toMatchObject({
      source: "DAAD",
      id: "10485",
      title: "PhD Position",
      professor: "Nikolay Kornienko",
      university: "University of Bonn",
      country: "Germany",
      funding: "TV-L E13, 50%",
      kind: "employment",
      deadline: "2026-10-30",
      posted: "2026-10-09",
      url: "https://www.daad.de/en/studying-in-germany/phd-studies-research/phd-germany/detail/10485/?phd-id=10485",
    });
  });
});

describe("AcademicTransfer's embedded vacancies", () => {
  it("resolves the Nuxt payload into salaried PhD posts", () => {
    const [row] = parseAcademicTransfer(sample("academictransfer-jobs.html"));
    expect(row).toMatchObject({
      source: "AcademicTransfer",
      id: "364611",
      university: "Universiteit Leiden",
      country: "Netherlands",
      funding: "EUR 3204 to 4051 a month",
      kind: "employment",
      deadline: "2026-11-07",
      posted: "2026-10-09",
    });
    expect(row?.title).toMatch(/^PhD Candidate/);
  });
});

describe("MUR's doctorate calls", () => {
  it("reads each open call with its university, closing date and sectors", () => {
    const rows = parseMur(sample("mur-fellowships.html"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source: "MUR",
      id: "316140",
      university: "Univ.Stran.REGGIO C.",
      country: "Italy",
      kind: "scholarship",
      funding: "PhD scholarship (borsa), 5 seats",
      deadline: "2026-10-11",
      url: "https://bandi.mur.gov.it/doctorate.php/public/fellowship/id_fellow/316140",
    });
    expect(rows[0]?.abstract).toContain("GSPS-06/A");
  });
});

describe("salary or stipend", () => {
  it("reads the posting's own words", () => {
    expect(payKind("Funding: fully funded. Standard EPSRC stipend")).toBe("scholarship");
    expect(payKind("TV-L E13 65%")).toBe("employment");
    expect(payKind("")).toBe("unknown");
  });
});

describe("which boards", () => {
  it("follow the places and the fields", () => {
    expect(positionSourcesFor(["UK", "Germany"], ["NLP"])).toEqual(["jobs.ac.uk", "DAAD"]);
    expect(positionSourcesFor(["Netherlands", "Italy"], ["NLP"])).toEqual([
      "AcademicTransfer",
      "MUR",
    ]);
    expect(positionSourcesFor([], ["astrophysics"])).toEqual(["jobs.ac.uk", "INSPIRE"]);
    expect(positionSourcesFor(["Japan"], ["particle physics"])).toEqual(["INSPIRE"]);
    expect(positionSourcesFor(["USA"], ["NLP"])).toEqual([]);
    // The rest of Europe reads EURAXESS by country; the UK keeps its own board.
    expect(positionSourcesFor(["Ireland", "Sweden"], ["NLP"])).toEqual(["EURAXESS"]);
    expect(positionSourcesFor(["UK"], ["NLP"])).toEqual(["jobs.ac.uk"]);
  });

  it("count days to a deadline", () => {
    const today = new Date("2026-10-09T20:00:00Z");
    expect(daysLeft("2026-10-23", today)).toBe(14);
    expect(daysLeft("2026-10-01", today)).toBe(-8);
    expect(daysLeft(null, today)).toBeNull();
  });
});
