import { describe, expect, it } from "vite-plus/test";
import { emailsIn, parseOpenAlexAwards } from "./sources-more.ts";

describe("OpenAlex awards", () => {
  it("rights SNSF's swapped names and keeps the funder", () => {
    const [a] = parseOpenAlexAwards({
      results: [
        {
          id: "https://openalex.org/G8021530088",
          display_name: "Medical NLP",
          funder: { display_name: "Swiss National Science Foundation" },
          lead_investigator: {
            given_name: "Rinaldi,",
            family_name: "Fabio",
            affiliation: { name: "SUPSI" },
          },
          institution_awarded: [
            { display_name: "University of Applied Sciences of Southern Switzerland" },
          ],
          amount: 1070390,
          currency: "CHF",
          landing_page_url: "https://data.snf.ch/grants/grant/10003518",
          start_date: "2025-03-01",
          end_date: "2028-02-29",
        },
      ],
    });
    expect(
      parseOpenAlexAwards({
        results: [{ lead_investigator: { given_name: "Rinaldi, Antonio", family_name: "Pio" } }],
      })[0]?.pi,
    ).toBe("Antonio Pio Rinaldi");
    expect(a).toMatchObject({
      source: "OpenAlex",
      funder: "Swiss National Science Foundation",
      id: "G8021530088",
      pi: "Fabio Rinaldi",
      university: "University of Applied Sciences of Southern Switzerland",
      currency: "CHF",
      ends: "2028-02-29",
    });
  });
});

describe("emails on papers", () => {
  const paper = (authors: unknown[]) => ({
    resultList: {
      result: [{ id: "42664967", source: "MED", pubYear: "2026", authorList: { author: authors } }],
    },
  });
  const author = (firstName: string, lastName: string, affiliation: string) => ({
    firstName,
    lastName,
    authorAffiliationDetailsList: { authorAffiliation: [{ affiliation }] },
  });

  it("keeps an address only when it holds the person's own name, at their school", () => {
    const body = paper([
      author(
        "Brenda",
        "Bass",
        "Department of Biochemistry, University of Utah. bbass@biochem.utah.edu",
      ),
      // A shared line can carry the corresponding author's address.
      author("Bruce", "Gale", "University of Utah. Electronic address: munawar.jawad@utah.edu"),
    ]);
    expect(emailsIn(body, "Brenda L. Bass", "University of Utah")).toEqual([
      {
        email: "bbass@biochem.utah.edu",
        paper: "https://europepmc.org/article/MED/42664967",
        year: "2026",
      },
    ]);
    expect(emailsIn(body, "Bruce Gale", "University of Utah")).toEqual([]);
    expect(emailsIn(body, "Brenda Bass", "Stanford University")).toEqual([]);
  });
});
