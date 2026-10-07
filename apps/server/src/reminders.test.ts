import { describe, expect, it } from "vite-plus/test";
import { openDb } from "./db.ts";
import { dueReminders, markReminded } from "./reminders.ts";
import { saveEdit, startApplication } from "./vault.ts";

describe("recommender reminders", () => {
  it("come 14 and 3 days out, once each, only for letters still owed", () => {
    const db = openDb(":memory:");
    saveEdit(db, {
      kind: "program",
      value: {
        id: "prg_1",
        university: "George Mason University",
        name: "PhD in IT",
        degree: "phd",
        deadline: "2026-12-01",
        fee: "",
        waiver: "",
        english: "",
        funding: "",
        asks: "",
        limit: "",
        eligibility: "",
        url: "",
        sources: [],
        note: "",
      },
    });
    const app = startApplication(db, "prg_1");
    saveEdit(db, {
      kind: "application",
      value: {
        ...app,
        status: "in-progress",
        recommenders: [
          { name: "Dr. Rahman", email: "r@uni.edu", status: "agreed" },
          { name: "Dr. Chen", email: "", status: "submitted" },
        ],
      },
    });
    expect(dueReminders(db, new Date("2026-11-01T12:00:00Z"))).toEqual([]);

    const tenOut = dueReminders(db, new Date("2026-11-21T12:00:00Z"));
    expect(tenOut.map((r) => r.key)).toEqual([`${app.id}:Dr. Rahman:14`]);
    expect(tenOut[0]?.about).toContain("due 2026-12-01, 11 days from now");
    markReminded(
      db,
      tenOut.map((r) => r.key),
    );
    expect(dueReminders(db, new Date("2026-11-22T12:00:00Z"))).toEqual([]);

    expect(dueReminders(db, new Date("2026-11-29T12:00:00Z")).map((r) => r.key)).toEqual([
      `${app.id}:Dr. Rahman:3`,
    ]);
  });
});
