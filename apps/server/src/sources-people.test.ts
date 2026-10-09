import { describe, expect, it } from "vite-plus/test";
import { applicantCircle, coAuthors, parseWorks } from "./sources-people.ts";

const GMU = { id: "https://openalex.org/I1", display_name: "George Mason University" };
const MIT = { id: "https://openalex.org/I2", display_name: "MIT" };
const author = (id: string, name: string, position: string, at: object[]) => ({
  author_position: position,
  author: { id: `https://openalex.org/${id}`, display_name: name },
  institutions: at,
});
// A professor (A9) and their works, newest first, as OpenAlex returns them.
const page = (works: [number, object[]][]) => ({
  results: works.map(([year, authorships], i) => ({
    id: `https://openalex.org/W${i}`,
    title: `Paper ${i}`,
    publication_year: year,
    doi: i === 0 ? "https://doi.org/10.1/x" : null,
    authorships,
  })),
});
const prof = author("A9", "Kevin Lybarger", "last", [GMU]);

describe("a professor's lab on OpenAlex", () => {
  it("keeps co-authors on 2+ works, and flags likely students and alumni", () => {
    const works = parseWorks(
      page([
        [2026, [author("A1", "Ada Student", "first", [GMU]), prof]],
        [
          2025,
          [
            author("A1", "Ada Student", "middle", [GMU]),
            author("A3", "Once", "first", [GMU]),
            prof,
          ],
        ],
        [2023, [author("A2", "Ben Alum", "first", [GMU]), prof]],
        [2022, [author("A2", "Ben Alum", "first", [GMU]), prof]],
      ]),
    );
    expect(works[0]).toMatchObject({
      title: "Paper 0",
      year: 2026,
      link: "https://doi.org/10.1/x",
    });
    expect(works[1]?.link).toBe("https://openalex.org/W1");

    const lab = coAuthors(
      "A9",
      ["I1"],
      works,
      2026,
      new Map([["A2", [{ id: "I2", name: MIT.display_name }]]]),
    );
    expect(lab).toEqual([
      {
        id: "A1",
        name: "Ada Student",
        link: "https://openalex.org/A1",
        shared: 2,
        lastYear: 2026,
        institution: "George Mason University",
        now: "",
        student: true,
        alumnus: false,
      },
      {
        id: "A2",
        name: "Ben Alum",
        link: "https://openalex.org/A2",
        shared: 2,
        lastYear: 2023,
        institution: "George Mason University",
        now: "MIT",
        student: false,
        alumnus: true,
      },
    ]);
  });
});

describe("the applicant's co-authors", () => {
  it("leaves out the professor, and the applicant once two papers show who they are", () => {
    const me = author("A5", "The Applicant", "first", []);
    const mine = parseWorks(
      page([
        [2025, [me, author("A6", "Co One", "middle", []), prof]],
        [2024, [me, author("A7", "Co Two", "last", [])]],
      ]),
    );
    expect(applicantCircle(mine, "A9").map((c) => c.name)).toEqual(["Co One", "Co Two"]);
    // From one paper alone the applicant can't be told apart.
    expect(applicantCircle(mine.slice(1), "A9").map((c) => c.name)).toEqual([
      "The Applicant",
      "Co Two",
    ]);
  });
});
