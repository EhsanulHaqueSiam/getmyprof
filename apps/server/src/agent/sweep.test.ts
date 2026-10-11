import { describe, expect, it } from "vite-plus/test";
import { openDb } from "../db.ts";
import { propose } from "../records.ts";
import { createThread } from "../threads.ts";
import {
  fieldVenues,
  noteSwept,
  papersIn,
  skip,
  surface,
  sweepNudge,
  sweptSchools,
  unchecked,
} from "./sweep.ts";

const GMU = "George Mason University";

describe("a hunt's sweep", () => {
  it("holds the hunt until everyone it surfaced is proposed, known or skipped", () => {
    const db = openDb(":memory:");
    const thread = createThread(db, "t").id;
    surface(db, thread, [
      { name: "Kevin Lybarger", university: GMU, via: "NSF 2442004" },
      { name: "Ziwei Zhu", university: GMU, via: "CSRankings acl 3, www 4" },
      { name: "Ray Bai", university: GMU, via: "NSF 2134567" },
    ]);
    // The same person surfaced again, spelled another way, is one candidate.
    surface(db, thread, [{ name: "LYBARGER, KEVIN J.", university: GMU, via: "NIH R01" }]);
    expect(unchecked(db, thread).map((p) => p.name)).toEqual([
      "Kevin Lybarger",
      "Ziwei Zhu",
      "Ray Bai",
    ]);
    propose(db, thread, {
      name: "Kevin Lybarger",
      university: GMU,
      fields: { fit: 5 },
      sources: ["https://www.lybargerlanguagelab.org"],
    });
    skip(db, thread, [{ name: "Ray Bai", university: GMU, why: "statistics, not NLP" }]);
    expect(sweepNudge(db, thread)).toContain(`${GMU}: Ziwei Zhu (CSRankings acl 3, www 4)`);
    skip(db, thread, [{ name: "Ziwei Zhu", university: GMU, why: "recommender systems" }]);
    expect(sweepNudge(db, thread)).toBeNull();
    // A finished sweep marks its schools, so a later Nightly sweep picks others.
    noteSwept(db, thread, "2026-10-11");
    expect(sweptSchools(db)).toEqual({ [GMU]: "2026-10-11" });
  });

  it("reads NLP authors from acl, emnlp and naacl, two papers or more", () => {
    const nlp = fieldVenues({ fields: ["clinical NLP"] });
    expect([...nlp]).toEqual(["acl", "emnlp", "naacl"]);
    expect(papersIn("www 4, acl 3, aaai 2, naacl 2, emnlp 1", nlp)).toBe(6);
    expect(papersIn("dac 7, iccad 7, emnlp 1", nlp)).toBe(1);
  });
});
