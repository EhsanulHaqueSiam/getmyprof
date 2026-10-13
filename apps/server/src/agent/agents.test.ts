import { describe, expect, it } from "vite-plus/test";
import { openDb } from "../db.ts";
import { DEFAULT_SETTINGS } from "../state.ts";
import { createThread, getThread, setSession } from "../threads.ts";
import { decide } from "./acp.ts";
import { CLAUDE_MODELS, threadAgent } from "./agents.ts";
import { fixtureSources } from "./fixture-sources.ts";
import { gatedRun } from "./mcp-hunt.ts";
import type { HuntTool } from "./tools.ts";

const OPTIONS = [
  { optionId: "allow_once", name: "Allow", kind: "allow_once" as const },
  { optionId: "allow_always", name: "Always allow", kind: "allow_always" as const },
  { optionId: "cancel", name: "Cancel", kind: "reject_once" as const },
];
const ask = (kind: "execute" | "fetch" | "edit", toolCallId = "t1") => ({
  sessionId: "s",
  toolCall: { toolCallId, kind },
  options: OPTIONS,
});
const picked = (r: ReturnType<typeof decide>) =>
  r.outcome.outcome === "selected" ? r.outcome.optionId : "cancelled";

describe("what an ACP agent may do", () => {
  const mine = new Set(["sheet_search", "propose_professor"]);
  it("allows a hunt tool it asked about by id alone, and web reads", () => {
    // Codex asks about an MCP call as kind "execute" with no name; its earlier tool_call named it.
    expect(picked(decide(ask("execute"), mine, { name: "sheet_search", detail: "" }))).toBe(
      "allow_once",
    );
    expect(picked(decide(ask("fetch"), mine))).toBe("allow_once");
  });
  it("refuses commands and edits", () => {
    expect(picked(decide(ask("execute"), mine))).toBe("cancel");
    expect(picked(decide(ask("edit"), mine, { name: "write", detail: "a.txt" }))).toBe("cancel");
  });
});

describe("the hunt tools over MCP", () => {
  const db = openDb(":memory:");
  const threadId = createThread(db, "t").id;
  const stops: string[] = [];
  let askOnly = false;
  const ctx = {
    db,
    threadId,
    settings: DEFAULT_SETTINGS,
    hunt: null,
    sources: fixtureSources,
    changed: () => {},
    outreachChanged: () => {},
    vaultChanged: () => {},
    ask: () => {},
    feature: () => "hunt",
    capHit: (reason: string) => stops.push(reason),
    spent: () => {},
    askOnly: () => askOnly,
  };
  const tool = (paid: boolean, price: number): HuntTool => ({
    name: "propose_professor",
    description: "",
    shape: {},
    paid,
    price: () => price,
    run: async () => ({ summary: "ran", text: "ok" }),
  });
  const text = (r: Awaited<ReturnType<typeof gatedRun>>) => r.content[0]?.text ?? "";

  it("asks before a paid call above the limit, and stops when declined", async () => {
    const asked: number[] = [];
    const s = {
      tools: [],
      ctx,
      askOver: () => 0.01,
      approve: async (a: { costUsd: number }) => (asked.push(a.costUsd), false),
    };
    const r = await gatedRun(tool(true, 0.05), {}, s);
    expect(asked).toEqual([0.05]);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("declined");
    // Under the limit it runs without asking.
    expect(text(await gatedRun(tool(true, 0.005), {}, s))).toContain("ran");
    expect(asked).toEqual([0.05]);
  });

  it("keeps to the caps and to Ask mode", async () => {
    const s = { tools: [], ctx, askOver: () => 99, approve: async () => true };
    const r = await gatedRun(tool(true, 5), {}, s);
    expect(r.isError).toBe(true);
    expect(stops).toHaveLength(1);
    askOnly = true;
    expect(text(await gatedRun(tool(false, 0), {}, s))).toContain("Ask mode");
    askOnly = false;
  });
});

describe("a thread's agent", () => {
  it("is fixed by the first message, from Settings", () => {
    const db = openDb(":memory:");
    const id = createThread(db, "t").id;
    const install = {
      ...DEFAULT_SETTINGS,
      agent: "codex" as const,
      model: "gpt-6-sol",
      effort: "high",
    };
    expect(threadAgent(db, id, install)).toEqual({
      agent: "codex",
      model: "gpt-6-sol",
      effort: "high",
    });
    // Settings changing later doesn't move it.
    expect(threadAgent(db, id, { ...install, agent: "opencode" }).agent).toBe("codex");
    expect(getThread(db, id)?.agent).toBe("codex");
  });

  it("stays on the SDK agent for a thread from before agents could be picked", () => {
    const db = openDb(":memory:");
    const id = createThread(db, "t").id;
    setSession(db, id, "an-old-session");
    const install = { ...DEFAULT_SETTINGS, agent: "codex" as const, model: "gpt-6-sol" };
    expect(threadAgent(db, id, install)).toEqual({
      agent: "claude",
      model: CLAUDE_MODELS[0]?.id,
      effort: "",
    });
  });
});
