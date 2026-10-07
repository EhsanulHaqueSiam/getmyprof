import type { Scholarship, VaultState } from "@gradcode/contracts";
import { describe, expect, it } from "vite-plus/test";
import { comingUp, fitsMe } from "./vault";

const scholarship = (s: Partial<Scholarship>): Scholarship => ({
  id: "s1",
  name: "Fulbright",
  sponsor: "US State Dept",
  studyIn: "USA",
  citizenship: ["Bangladesh"],
  tracks: ["phd"],
  amount: "",
  deadline: null,
  url: "",
  sources: [],
  status: "watch",
  note: "",
  ...s,
});

describe("the Vault", () => {
  it("shows a scholarship as fitting only when citizenship and track both match", () => {
    const me = { citizenship: ["bangladesh"] };
    expect(fitsMe(scholarship({}), me, ["phd"])).toBe(true);
    expect(fitsMe(scholarship({ citizenship: ["India"] }), me, ["phd"])).toBe(false);
    expect(fitsMe(scholarship({ citizenship: [], tracks: ["funded_ms"] }), me, ["phd"])).toBe(
      false,
    );
  });

  it("lists what's coming up soonest first: expiring documents, open applications, closing rounds", () => {
    const now = new Date(2026, 9, 7);
    const v: VaultState = {
      documents: [
        {
          id: "d1",
          name: "passport.pdf",
          kind: "passport",
          mime: "",
          size: 1,
          expires: "2027-03-01",
          uploadedAt: "",
          sha256: "",
        },
        {
          id: "d2",
          name: "old.pdf",
          kind: "other",
          mime: "",
          size: 1,
          expires: "2031-01-01",
          uploadedAt: "",
          sha256: "",
        },
      ],
      programs: [
        {
          id: "p1",
          university: "GMU",
          name: "PhD IT",
          degree: "phd",
          deadline: "2026-10-20",
          fee: "",
          waiver: "",
          english: "",
          funding: "",
          url: "",
          sources: [],
          note: "",
        },
      ],
      applications: [
        {
          id: "a1",
          programId: "p1",
          status: "in-progress",
          waiver: "none",
          documents: [{ name: "CV", docId: null, done: false }],
          recommenders: [],
          portal: "",
          portalStatus: "",
          professors: [],
          submittedAt: null,
          note: "",
        },
      ],
      scholarships: [
        scholarship({ deadline: "2026-11-01", status: "applying" }),
        scholarship({ id: "s2", name: "Just watching", deadline: "2026-10-10" }),
      ],
      writing: [],
      toFile: [],
    };
    expect(comingUp(v, now).map((u) => u.text)).toEqual([
      "GMU · PhD IT due in 13 days · 1 item left",
      "Fulbright closes in 25 days",
      "passport.pdf expires in 145 days",
    ]);
  });
});
