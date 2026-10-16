import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ANID,
  ANR,
  ANR_LEADS,
  cached,
  type FileSpec,
  NSERC,
  RCN,
  readAwards,
  RESEARCH_IRELAND,
  SFI,
} from "./sources-files.ts";

/** A saved sample's awards, decoded as the live file is. */
const first = (spec: FileSpec, name: string) =>
  readAwards(
    spec,
    new TextDecoder(spec.encoding ?? "utf-8").decode(
      NodeFS.readFileSync(NodePath.join(import.meta.dirname, "__samples__", name)),
    ),
  );

describe("national grant files name the PI", () => {
  it("NSERC: the applicant, per-year amounts, five years from the competition", () => {
    expect(first(NSERC, "nserc.csv")[0]).toMatchObject({
      source: "NSERC",
      id: "305407-2017",
      pi: "John JP Smol",
      university: "Queen's University",
      amount: 24000,
      currency: "CAD",
      starts: "2017-04-01",
      ends: "2022-03-31",
    });
  });

  it("Research Ireland: US dates, euro amounts, Windows text", () => {
    expect(first(RESEARCH_IRELAND, "research-ireland.csv")[0]).toMatchObject({
      source: "IRELAND",
      id: "25/HERA/4047",
      title:
        "CoastARTS: Coastlines as Zones of Ecocultural Crisis – Shaping Resilience through Transnational Performance-based Arts",
      pi: "Patrick Lonergan",
      university: "University of Galway",
      amount: 132330.08,
      currency: "EUR",
      starts: "2025-02-01",
      ends: "2028-01-31",
    });
  });

  it("SFI: the host without its initials", () => {
    expect(first(SFI, "sfi.csv")[0]).toMatchObject({
      pi: "Brian Mac Namee",
      university: "University College Dublin",
      amount: 15594868,
      ends: "2027-12-31",
    });
  });

  it("RCN: granted projects only, by year, in NOK", () => {
    const [a] = first(RCN, "rcn.csv");
    expect(a).toMatchObject({
      source: "RCN",
      id: "101233",
      pi: "Asbjørn Mo",
      currency: "NOK",
      starts: "1993-01-01",
      ends: "2015-12-31",
      url: "https://prosjektbanken.forskningsradet.no/project/FORISS/101233",
    });
    // A department's own line ("Institutt for sosiologi...") gives way to its university.
    expect(first(RCN, "rcn.csv").find((x) => x.id === "105034")?.university).toBe(
      "University of Oslo",
    );
  });

  it("ANID: research grants without scholarships or postdocs, pesos from thousands", () => {
    const awards = first(ANID, "anid.csv");
    expect(awards).toHaveLength(17);
    expect(awards[0]).toMatchObject({
      source: "ANID",
      id: "1240601",
      pi: "Pugazhenthiran Nalandhiran",
      university: "Universidad Tecnica Federico Santa Maria",
      amount: 229189000,
      currency: "CLP",
      starts: "2024-01-01",
      ends: "2027-12-31",
    });
  });

  it("ANR: English titles, four years from the start, the coordinator from the partners file", () => {
    expect(first(ANR, "anr-projects.csv")[0]).toMatchObject({
      source: "ANR",
      id: "ANR-26-TSIA-0011",
      title: "Multi-Agent for clinical decision support in Molecular Tumor Board (MA-MTB)",
      amount: 699951.5,
      starts: "2026-04-01",
      ends: "2030-04-01",
      url: "https://anr.fr/Projet-ANR-26-TSIA-0011",
    });
    const leads = first(ANR_LEADS, "anr-partners.csv");
    // Two of the twenty projects name no coordinator.
    expect(leads).toHaveLength(18);
    expect(leads.find((l) => l.id === "ANR-26-TSIA-0011")).toMatchObject({
      pi: "Loic Verlingue",
      university: "Centre Léon Bérard",
    });
  });
});

describe("the file cache", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads a fresh copy without looking up the file's URL", async () => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gmp-cache-"));
    vi.stubEnv("GETMYPROF_HOME", home);
    NodeFS.mkdirSync(NodePath.join(home, "cache"));
    NodeFS.writeFileSync(NodePath.join(home, "cache", "x.csv"), "a,b\n");
    const lookUp = vi.fn(async () => "https://example.invalid/x.csv");
    expect(await cached("x.csv", lookUp)).toBe("a,b\n");
    expect(lookUp).not.toHaveBeenCalled();
  });
});
