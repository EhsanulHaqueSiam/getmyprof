import { Methods } from "@gradcode/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it } from "vite-plus/test";
import { fakeProvider } from "./agent/fake.ts";
import { fixtureSources } from "./agent/fixtures.ts";
import { createRunner } from "./agent/runner.ts";
import { createBus } from "./bus.ts";
import { openDb } from "./db.ts";
import { build, sameToken } from "./mcp.ts";
import { createOutreach } from "./outreach/service.ts";
import { blankProfessor, putRecord } from "./records.ts";
import { createHandlers } from "./rpc.ts";
import { getSettings, updateSettings } from "./state.ts";

const textOf = (r: unknown) => JSON.stringify(r).match(/"text":"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";

describe("gradcode as an MCP server", () => {
  it("lets another agent search the sheet and start a hunt", async () => {
    const db = openDb(":memory:");
    putRecord(db, {
      ...blankProfessor("Kevin Lybarger", "George Mason University"),
      niche: "clinical NLP",
    });
    const bus = createBus();
    const runner = createRunner({ db, bus, provider: fakeProvider(1), sources: fixtureSources });
    const outreach = createOutreach({
      db,
      bus,
      runner,
      mailerFor: () => {
        throw new Error("no mail");
      },
    });
    const handlers = createHandlers({
      db,
      bus,
      runner,
      sources: fixtureSources,
      fake: true,
      startLoop: () => {
        throw new Error("no loops");
      },
      outreach,
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    // Same exactOptionalPropertyTypes mismatch as in mcp.ts: one object, two type views.
    await build(db, handlers).connect(a as Transport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b as Transport);

    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      "sheet_search",
      "start_hunt",
      "list_threads",
      "read_thread",
      "review_list",
      "review_resolve",
    ]);
    expect(
      textOf(await client.callTool({ name: "sheet_search", arguments: { query: "nlp" } })),
    ).toContain("Kevin Lybarger | George Mason University");
    expect(
      textOf(
        await client.callTool({
          name: "start_hunt",
          arguments: { text: "Find funded NLP professors" },
        }),
      ),
    ).toMatch(/^Started thread thr_/);
    await client.close();
  });

  it("keeps your servers and its token when another setting changes", () => {
    const db = openDb(":memory:");
    const before = updateSettings(db, {
      mcpServers: [
        { transport: "http", name: "papers", url: "https://example.com/mcp", trusted: false },
      ],
    });
    // Through the wire's own input schema, the way the Settings page sends it.
    updateSettings(db, Methods["settings.update"].input.parse({ detail: "brief" }));
    expect(getSettings(db)).toMatchObject({
      detail: "brief",
      mcpServers: before.mcpServers,
      mcpToken: before.mcpToken,
    });
  });

  it("answers only to its own token", () => {
    expect(sameToken("abc", "abc")).toBe(true);
    expect(sameToken("abd", "abc")).toBe(false);
    expect(sameToken("", "")).toBe(false);
  });
});
