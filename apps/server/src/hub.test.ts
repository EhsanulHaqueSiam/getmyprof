import { type CatalogFact, type ProgressReport } from "@getmyprof/contracts";
import { describe, expect, it } from "vite-plus/test";
import { openDb } from "./db.ts";
import { applyCatalog, connectHub, hubStatus, setMember, syncHub } from "./hub-member.ts";
import {
  addFacts,
  hubRequest,
  inviteStudent,
  listStudents,
  mergeFact,
  publicFacts,
  readInvite,
  removeStudent,
  servedCatalog,
} from "./hub.ts";
import { blankProfessor, getRecord, putRecord, threadProposals } from "./records.ts";
import { saveFacts } from "./state.ts";
import { proposeFinding, saveEdit, vaultState } from "./vault.ts";

const HUB = "https://counselor.example.ts.net:8443";

const report: ProgressReport = {
  at: "2026-10-09T08:00:00.000Z",
  hunt: "Fall 2027 · funded PhD",
  counts: { schools: 1, professors: 2, emailed: 1, replied: 0, applications: 0 },
  shortlist: [],
  replies: [],
  upcoming: [{ date: "2026-10-14", title: "GMU fee waiver request" }],
};

const program = {
  university: "George Mason University",
  name: "PhD in Information Technology",
  degree: "phd" as const,
  deadline: "2026-12-01",
  fee: "$75",
  waiver: "on request",
  english: "IELTS 6.5",
  funding: "GRA/GTA",
  asks: "",
  limit: "",
  conflicts: "",
  decisions: "",
  url: "https://cec.gmu.edu/phd",
  sources: ["https://cec.gmu.edu/phd"],
};

const professorFact = (item: Partial<Extract<CatalogFact, { kind: "professor" }>["item"]>) =>
  ({
    kind: "professor",
    checkedAt: "2026-10-01T00:00:00.000Z",
    item: {
      name: "Ziyu Yao",
      university: "George Mason University",
      email: "",
      emailCheck: "",
      website: "",
      scholar: "",
      recent: "",
      taking: "",
      sources: ["https://cs.gmu.edu/~ziyuyao"],
      ...item,
    },
  }) satisfies CatalogFact;

/** A hub with one invited student; returns the hub, the code and the student's bearer header. */
function hubWithStudent(name = "rafi") {
  const db = openDb(":memory:");
  const { code } = inviteStudent(db, name, `${HUB}/`);
  return { db, code, auth: `Bearer ${readInvite(code).t}` };
}

describe("the hub", () => {
  it("makes an invite code that reads back as its URL, token and name", () => {
    const { db, code } = hubWithStudent();
    const invite = readInvite(code);
    expect(invite.u).toBe(HUB);
    expect(invite.n).toBe("rafi");
    expect(invite.t.length).toBeGreaterThan(16);
    expect(listStudents(db).map((s) => [s.name, s.report])).toEqual([["rafi", null]]);
    expect(() => readInvite("not a code")).toThrow(/isn't an invite code/);
    expect(() => inviteStudent(db, "lena", "counselor.example")).toThrow(/address/);
  });

  it("answers students only with their token, under 1 MB, with a body that parses", () => {
    const { db, auth } = hubWithStudent();
    const post = (body: string | null, authorization = auth) =>
      hubRequest(db, { method: "POST", path: "/api/hub/report", authorization, body }).status;
    expect(post(JSON.stringify(report), "")).toBe(401);
    expect(post(JSON.stringify(report), "Bearer wrong-token-of-some-length")).toBe(401);
    expect(post(null)).toBe(413);
    expect(post("{not json")).toBe(400);
    expect(post(JSON.stringify({ hunt: "no counts" }))).toBe(400);
    expect(listStudents(db)[0]?.syncedAt).toBeNull();

    expect(post(JSON.stringify(report))).toBe(200);
    const [student] = listStudents(db);
    expect(student?.report).toEqual(report);
    expect(student?.syncedAt).not.toBeNull();
    const catalog = (path: string) =>
      hubRequest(db, { method: "GET", path, authorization: auth, body: "" }).status;
    expect(catalog("/api/hub/catalog")).toBe(200);
    expect(catalog("/api/hub/nothing")).toBe(404);
    // A removed student's token stops working.
    removeStudent(db, student?.id ?? "");
    expect(post(JSON.stringify(report))).toBe(401);
  });

  it("keeps the newer check of a fact and counts everyone who gave it", () => {
    const older = { kind: "program", checkedAt: "2026-09-01", item: program } as const;
    const newer = {
      ...older,
      checkedAt: "2026-10-02",
      item: { ...program, deadline: "2026-12-15" },
    };
    const once = mergeFact(undefined, newer, "stu_a");
    const twice = mergeFact(once, older, "stu_b");
    expect(twice.fact.item).toMatchObject({ deadline: "2026-12-15" });
    expect(twice.contributors).toEqual(["stu_a", "stu_b"]);
    expect(mergeFact(twice, newer, "stu_a").contributors).toEqual(["stu_a", "stu_b"]);

    // Spelled differently, it's the same program; the hub's own Vault joins as "hub", and its
    // check (filed just now) is the newest.
    const db = openDb(":memory:");
    addFacts(db, [older], "stu_a");
    addFacts(
      db,
      [{ ...newer, item: { ...newer.item, name: "PhD in information technology" } }],
      "stu_b",
    );
    saveEdit(db, {
      kind: "program",
      value: { ...program, id: "prog_1", eligibility: "", note: "" },
    });
    const served = servedCatalog(db).facts;
    expect(served).toHaveLength(1);
    expect(served[0]?.by).toBe(3);
    expect(served[0]?.fact.item).toMatchObject({ deadline: "2026-12-01" });
  });
});

describe("a student's install", () => {
  it("files new programs, and proposes only checked changes to professors already in the sheet", () => {
    const db = openDb(":memory:");
    putRecord(db, { ...blankProfessor("Ziyu Yao", "George Mason University"), email: "z@gmu.edu" });
    const catalog = {
      facts: [
        { fact: { kind: "program" as const, checkedAt: "2026-10-02", item: program }, by: 2 },
        {
          fact: professorFact({
            email: "ziyu@gmu.edu",
            emailCheck: "unchecked",
            recent: "2026 ACL paper",
          }),
          by: 1,
        },
        { fact: professorFact({ name: "Someone Else", website: "https://x.edu" }), by: 1 },
      ],
    };
    const first = applyCatalog(db, catalog);
    expect(first).toMatchObject({ filed: 1, proposed: 1 });
    expect(vaultState(db).toFile.map((f) => f.why)).toEqual([
      "From the shared catalog, checked by 2",
    ]);
    const [proposal] = threadProposals(db, first.threadId ?? "");
    // The unchecked address stays out; the person not in the sheet is skipped.
    expect(proposal?.changes.map((c) => [c.field, c.to])).toEqual([["recent", "2026 ACL paper"]]);
    expect(proposal?.sources).toEqual(["https://cs.gmu.edu/~ziyuyao"]);

    // Pulled again, nothing comes twice; a checked address arrives with its check.
    expect(applyCatalog(db, catalog)).toMatchObject({ filed: 0, proposed: 0 });
    const checked = professorFact({ email: "ziyu@gmu.edu", emailCheck: "ok, on the lab page" });
    expect(applyCatalog(db, { facts: [{ fact: checked, by: 1 }] })).toMatchObject({ proposed: 1 });
    expect(threadProposals(db, first.threadId ?? "")[1]?.changes.map((c) => c.field)).toEqual([
      "email",
      "emailCheck",
    ]);
    expect(getRecord(db, "ziyu-yao@george-mason-university")?.email).toBe("z@gmu.edu");
  });

  it("gives back public facts only: no profile facts, fit, stage, notes or eligibility", () => {
    const db = openDb(":memory:");
    saveFacts(db, [
      {
        id: "fact_1",
        kind: "education",
        text: "SECRET-FACT BSc CSE",
        source: "",
        date: "",
        confirmed: true,
        question: false,
        planned: false,
      },
    ]);
    putRecord(db, {
      ...blankProfessor("Kevin Lybarger", "George Mason University"),
      email: "kl@gmu.edu",
      emailCheck: "ok",
      fit: 5,
      stage: "sent",
      fitsBecause: "SECRET-FIT",
      hook: "SECRET-HOOK",
      warm: "SECRET-WARM",
      sources: ["https://cs.gmu.edu/~kl", "reply from Kevin SECRET-REPLY"],
    });
    saveEdit(db, {
      kind: "program",
      value: {
        ...program,
        id: "prog_1",
        eligibility: "no: SECRET-ELIGIBILITY",
        note: "SECRET-NOTE",
      },
    });
    proposeFinding(db, {
      kind: "program",
      why: "",
      threadId: null,
      item: { ...program, name: "MS" },
    });
    const facts = publicFacts(db);
    expect(facts.map((f) => f.kind)).toEqual(["program", "professor"]);
    expect(JSON.stringify(facts)).not.toMatch(/SECRET|"fit"|"stage"|"note"|eligibility/);
    expect(facts[1]?.item).toMatchObject({
      email: "kl@gmu.edu",
      sources: ["https://cs.gmu.edu/~kl"],
    });
  });

  it("syncs with a hub: the report lands, the catalog comes back, give-back only when on", async () => {
    const hub = hubWithStudent();
    saveEdit(hub.db, {
      kind: "program",
      value: { ...program, id: "prog_h", eligibility: "", note: "" },
    });
    const student = openDb(":memory:");
    putRecord(student, {
      ...blankProfessor("Ziyu Yao", "George Mason University"),
      website: "https://cs.gmu.edu/~ziyuyao",
    });
    connectHub(student, hub.code);
    // The hub answers through its own handler: a self-loop, no port.
    const fetcher = async (url: string, init: RequestInit) => {
      const authorization = new Headers(init.headers).get("authorization") ?? undefined;
      const body = typeof init.body === "string" ? init.body : "";
      const r = hubRequest(hub.db, {
        method: init.method ?? "GET",
        path: new URL(url).pathname,
        authorization,
        body,
      });
      return new Response(JSON.stringify(r.json), { status: r.status });
    };

    await syncHub(student, fetcher);
    expect(listStudents(hub.db)[0]?.report?.counts.professors).toBe(1);
    expect(vaultState(student).toFile.map((f) => f.item.name)).toEqual([program.name]);
    expect(hubStatus(student)).toMatchObject({
      host: "counselor.example.ts.net:8443",
      lastError: "",
      giveBack: false,
    });
    expect(servedCatalog(hub.db).facts.map((f) => f.fact.kind)).toEqual(["program"]);

    setMember(student, { giveBack: true });
    await syncHub(student, fetcher);
    expect(servedCatalog(hub.db).facts.map((f) => f.fact.kind)).toEqual(["professor", "program"]);

    removeStudent(hub.db, listStudents(hub.db)[0]?.id ?? "");
    await syncHub(student, fetcher);
    expect(hubStatus(student)?.lastError).toMatch(/doesn't know this invite/);
  });
});
