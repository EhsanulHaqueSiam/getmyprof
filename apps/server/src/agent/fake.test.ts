import { describe, expect, it } from "vite-plus/test";
import { createBus } from "../bus.ts";
import { openDb } from "../db.ts";
import { issuesFor, listMessages } from "../outreach/store.ts";
import { getRecord, putRecord, recordKey, resolveProposal, threadProposals } from "../records.ts";
import { saveFacts } from "../state.ts";
import { createThread, getThread, listEvents } from "../threads.ts";
import { listApplications, saveEdit, startApplication } from "../vault.ts";
import { fakeProvider } from "./fake.ts";
import { fixtureSources } from "./fixtures.ts";
import { createRunner } from "./runner.ts";

const until = async (check: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("the scripted agent's first messages", () => {
  // e2e sends Lybarger's first email untouched, so it has to pass every draft check.
  it("pass every draft check after a hunt: an email to a checked address, a LinkedIn note without", async () => {
    const db = openDb(":memory:");
    saveFacts(db, [
      {
        id: "f_bsc",
        text: "BSc in Computer Science, 2025",
        source: "CV p1",
        kind: "education",
        date: "2025",
        confirmed: true,
        question: false,
        planned: false,
      },
    ]);
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "health NLP").id;
    runner.send(thread, "find health NLP professors", "send");
    await until(() => getThread(db, thread)?.status === "idle");
    for (const p of threadProposals(db, thread)) resolveProposal(db, p.id, "accept");

    const lybarger = recordKey("Kevin Lybarger", "George Mason University");
    const zalake = recordKey("Mohan Zalake", "University of Illinois Chicago");
    const record = getRecord(db, lybarger);
    if (!record) throw new Error("expected Lybarger in the sheet");
    putRecord(db, { ...record, emailCheck: "ok, on the lab page" });
    runner.rowAction(thread, "draft", [lybarger, zalake]);
    await until(() => listMessages(db).length === 2);
    await until(() => getThread(db, thread)?.status === "idle");

    const [email, note] = [lybarger, zalake].map((k) => listMessages(db, k)[0]);
    expect(email).toMatchObject({ channel: "email", subject: "PhD 2027: clinical NLP" });
    expect(email?.body).toContain("DF-RAG: Query-Aware Diversity");
    expect(email?.body).toContain("BSc in Computer Science, 2025 [1]");
    expect(note).toMatchObject({ channel: "linkedin" });
    for (const m of [email, note]) expect(m && issuesFor(db, m)).toEqual([]);
  });

  it("checks a lab on OpenAlex before proposing who is in it", async () => {
    const db = openDb(":memory:");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "lab").id;
    runner.send(thread, "find health NLP professors", "send");
    await until(() => getThread(db, thread)?.status === "idle");
    for (const p of threadProposals(db, thread)) resolveProposal(db, p.id, "accept");
    runner.rowAction(thread, "lab", [recordKey("Kevin Lybarger", "George Mason University")]);
    await until(() => threadProposals(db, thread).some((p) => p.status === "pending"));
    await until(() => getThread(db, thread)?.status === "idle");
    expect(
      listEvents(db, thread).find((e) => e.type === "tool" && e.name === "lab_members"),
    ).toMatchObject({ status: "done", meta: "2 co-authors" });
    const lab = threadProposals(db, thread).find((p) => p.status === "pending");
    expect(lab?.changes.map((c) => c.field)).toEqual(["lab"]);
  });
});

describe("the scripted agent on a portal", () => {
  it("saves an answer for each field it was given, by the portal's own label", async () => {
    const db = openDb(":memory:");
    saveEdit(db, {
      kind: "program",
      value: {
        id: "gmu",
        university: "George Mason University",
        name: "PhD in Information Technology",
        degree: "phd",
        deadline: "2026-12-01",
        fee: "$75",
        waiver: "",
        english: "",
        funding: "",
        url: "https://gmu.edu/phd",
        sources: [],
        note: "",
      },
    });
    const app = startApplication(db, "gmu");
    const runner = createRunner({
      db,
      bus: createBus(),
      provider: fakeProvider(1),
      sources: fixtureSources,
    });
    const thread = createThread(db, "Portal").id;
    runner.send(
      thread,
      `[portal] app=${app.id}\nAnswer these.\n- Why this program? (100 words) | textarea\n- Preferred start term | select | options: Fall 2027; Spring 2028`,
      "send",
    );
    await until(() => (listApplications(db)[0]?.answers.length ?? 0) === 2);
    expect(listApplications(db)[0]?.answers.map((a) => [a.label, a.value])).toEqual([
      ["Why this program? (100 words)", "Fixture answer for Why this program? (100 words)"],
      ["Preferred start term", "Fall 2027"],
    ]);
  });
});
