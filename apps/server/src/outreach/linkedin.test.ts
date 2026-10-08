import { describe, expect, it } from "vite-plus/test";
import type { Sources } from "../agent/sourcing.ts";
import { fixtureSources } from "../agent/fixtures.ts";
import { openDb } from "../db.ts";
import { updateSettings } from "../state.ts";
import { daySpend, daySpendOutsideThreads } from "../threads.ts";
import { linkedinOpen } from "./linkedin.ts";

const profile = "https://www.linkedin.com/in/kevin-lybarger";

describe("opening a LinkedIn note", () => {
  it("buys the member id once, then opens their message box for free", async () => {
    const db = openDb(":memory:");
    updateSettings(db, { treg: true });
    let calls = 0;
    const sources: Sources = {
      ...fixtureSources,
      treg: async () => {
        calls++;
        return {
          ok: true,
          result: { id: "urn:li:fsd_profile:ACoAAB12_x", firstName: "Kevin" },
          callId: "c1",
          costUsd: 0.0015,
        };
      },
    };
    const first = await linkedinOpen(db, sources, "k1", profile);
    expect(first.url).toBe(
      "https://www.linkedin.com/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3AACoAAB12_x&recipient=ACoAAB12_x",
    );
    expect(daySpend(db)).toBe(0.0015);
    // It belongs to no thread, and still counts in today's spend.
    expect(daySpendOutsideThreads(db)).toBe(0.0015);
    expect((await linkedinOpen(db, sources, "k1", profile)).url).toBe(first.url);
    expect(calls).toBe(1);
  });

  it("opens their profile when paid lookups are off or treg can't tell", async () => {
    const db = openDb(":memory:");
    expect(await linkedinOpen(db, fixtureSources, "k1", profile)).toEqual({
      url: profile,
      note: "",
    });
    updateSettings(db, { treg: true });
    const blank: Sources = {
      ...fixtureSources,
      treg: async () => ({ ok: true, result: {}, callId: "c2", costUsd: 0.0015 }),
    };
    expect((await linkedinOpen(db, blank, "k1", profile)).url).toBe(profile);
  });
});
