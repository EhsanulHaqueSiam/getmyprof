// getmyprof as an MCP server, so any agent can drive a hunt: search the sheet, start
// a hunt, read threads, and work Review. Each tool is a thin wrapper over an RPC handler. bin.ts
// serves it at /api/mcp (streamable HTTP, stateless) behind the bearer token in Settings.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.ts";
import { listRecords, threadProposals } from "./records.ts";
import type { createHandlers } from "./rpc.ts";
import { getSettings } from "./state.ts";
import { listThreads } from "./threads.ts";

type Handlers = ReturnType<typeof createHandlers>;
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Every pending proposal across threads, as Review shows them. */
const pendingReview = (db: Db) =>
  listThreads(db).flatMap((t) => threadProposals(db, t.id).filter((p) => p.status === "pending"));

/** The MCP server with getmyprof's tools. Exported for tests; serveMcp is the HTTP door. */
export function build(db: Db, handlers: Handlers) {
  const server = new McpServer({ name: "getmyprof", version: "1.0.0" });
  server.registerTool(
    "sheet_search",
    {
      description: "Search the applicant's professor sheet by name, school or niche.",
      inputSchema: { query: z.string().optional(), university: z.string().optional() },
    },
    async ({ query, university }) => {
      const has = (s: string, q?: string) => !q || s.toLowerCase().includes(q.toLowerCase());
      const rows = listRecords(db).filter(
        (p) => has(p.university, university) && has(`${p.name} ${p.niche}`, query),
      );
      return text(
        rows
          .slice(0, 50)
          .map(
            (p) =>
              `${p.name} | ${p.university} | fit ${p.fit} | money tier ${p.moneyTier} | ${p.money || "?"} | taking ${p.taking || "?"} | ${p.stage}`,
          )
          .join("\n") || "Nothing matches.",
      );
    },
  );
  server.registerTool(
    "start_hunt",
    {
      description:
        "Start a getmyprof thread with an instruction, e.g. 'Find funded NLP professors at UIC'. Returns the thread id; the hunt runs on its own.",
      inputSchema: { text: z.string().min(1), title: z.string().optional() },
    },
    async ({ text: t, title }) => {
      const thread = await handlers["threads.create"]({ text: t, ...(title ? { title } : {}) });
      return text(`Started thread ${thread.id} (${thread.title}).`);
    },
  );
  server.registerTool(
    "list_threads",
    { description: "List getmyprof's threads: status, what waits in Review, spend." },
    async () =>
      text(
        listThreads(db)
          .slice(0, 50)
          .map(
            (t) =>
              `${t.id} | ${t.title} | ${t.settledAt ? "settled" : t.status} | review ${t.pendingReview} | $${t.spendUsd.toFixed(4)}`,
          )
          .join("\n") || "No threads.",
      ),
  );
  server.registerTool(
    "read_thread",
    {
      description: "Read a thread's latest messages and findings.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const v = await handlers["threads.view"]({ id });
      const lines = v.events
        .slice(-30)
        .flatMap((e) =>
          e.type === "user" ||
          e.type === "assistant" ||
          e.type === "system" ||
          e.type === "question"
            ? [`${e.type}: ${e.text}`]
            : e.type === "tool"
              ? [`tool ${e.name} ${e.detail}: ${e.meta || e.status}`]
              : [],
        );
      return text(`${v.thread.title} (${v.thread.status})\n${lines.join("\n")}`);
    },
  );
  server.registerTool(
    "review_list",
    { description: "List every proposed change waiting in Review, with its id." },
    async () =>
      text(
        pendingReview(db)
          .map(
            (p) =>
              `${p.id} | ${p.kind} ${p.recordName} (${p.university}) | ${p.changes.map((c) => `${c.field}: ${c.to}`).join("; ")}`,
          )
          .join("\n") || "Nothing waits in Review.",
      ),
  );
  server.registerTool(
    "review_resolve",
    {
      description:
        "Accept or reject proposals by id. Rejecting a new professor excludes them for good.",
      inputSchema: { ids: z.array(z.string()).min(1), decision: z.enum(["accept", "reject"]) },
    },
    async ({ ids, decision }) => {
      await handlers["proposals.resolve"]({ ids, decision });
      return text(`${decision === "accept" ? "Accepted" : "Rejected"} ${ids.length}.`);
    },
  );
  return server;
}

export const sameToken = (given: string, mine: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(mine);
  return a.length === b.length && b.length > 0 && NodeCrypto.timingSafeEqual(a, b);
};

/**
 * Serves one MCP request. Stateless: a fresh server and transport per POST, so nothing lingers.
 * Refuses anything without the bearer token from Settings.
 */
export async function serveMcp(
  db: Db,
  handlers: Handlers,
  req: NodeHttp.IncomingMessage,
  res: NodeHttp.ServerResponse,
  body: unknown,
) {
  const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  if (!sameToken(auth, getSettings(db).mcpToken)) {
    res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
    return;
  }
  const server = build(db, handlers);
  // No sessionIdGenerator: stateless mode, one request per transport.
  const transport = new StreamableHTTPServerTransport();
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  // The SDK's own transport fails its own Transport type only under exactOptionalPropertyTypes;
  // it is the same object at runtime.
  await server.connect(transport as Transport);
  await transport.handleRequest(req, res, body);
}
