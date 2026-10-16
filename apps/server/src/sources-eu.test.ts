import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseEtis, parseNwo, parseRadon, parseResearchFi } from "./sources-eu.ts";

const sample = (name: string): unknown =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(import.meta.dirname, "__samples__", name), "utf8"));

describe("European funders name the PI", () => {
  it("NWO: the project leader and their institute", () => {
    expect(parseNwo(sample("nwo-projects.json"))[0]).toMatchObject({
      source: "NWO",
      id: "016.Veni.192.235",
      pi: "Daniël Pelt",
      university: "CWI - Centrum Wiskunde & Informatica",
      amount: 249837,
      currency: "EUR",
      starts: "2018-09-01",
      ends: "2023-02-28",
      url: "https://www.nwo.nl/en/projects/016.Veni.192.235",
    });
  });

  it("research.fi: the contact person and the consortium lead", () => {
    expect(parseResearchFi(sample("researchfi-funding.json"))[0]).toMatchObject({
      source: "RESEARCHFI",
      id: "26882",
      title: "Machine Learning for Industry Applications",
      pi: "Heikki Huttunen",
      university: "Tampere University",
      amount: 600000,
      starts: "2018-01-01",
      ends: "2020-09-30",
    });
  });

  it("RAD-on: the project manager and the leading institution, in PLN", () => {
    const [a] = parseRadon(sample("radon-projects.json"));
    expect(a).toMatchObject({ source: "RADON", currency: "PLN", starts: "2021-08-31" });
    expect(a?.pi).toMatch(/\S+ \S+/);
    expect(a?.university).toBe("Uniwersytet Łódzki");
  });

  it("ETIS: the principal investigator from the display line, the university without its faculty", () => {
    expect(parseEtis(sample("etis-projects.json"))[0]).toMatchObject({
      source: "ETIS",
      funder: "Estonian Research Council",
      id: "PRG2006",
      title: "Language Technology for Low-Resource Finno-Ugric Languages and Dialects",
      pi: "Mark Fišel",
      university: "University of Tartu",
      currency: "EUR",
      starts: "2024-01-01",
      ends: "2028-12-31",
    });
  });
});
