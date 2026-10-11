// The hunt tools for agents that aren't Claude Code (agent/acp.ts): served over MCP at
// /api/mcp/hunt, one bearer token per running session, so each call runs in that thread with its
// approvals and caps. Claude Code gets the same tools in process (agent/claude.ts).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import * as NodeCrypto from "node:crypto";
import type * as NodeHttp from "node:http";
import { z } from "zod";
import { sameToken } from "../mcp.ts";
import type { SessionHooks } from "./provider.ts";
import { askBlocked, capProblem, type HuntTool, type ToolContext } from "./tools.ts";

export type HuntSession = {
  tools: HuntTool[];
  ctx: ToolContext;
  askOver: () => number;
  approve: SessionHooks["requestApproval"];
};

const sessions = new Map<string, HuntSession>();
let base = "";

/** Where this server answers, set once it listens: the agents reach their tools here. */
export const setHuntUrl = (url: string) => {
  base = url;
};

/** Opens a session's door: its URL and token, and a close that shuts it. */
export function openHuntSession(s: HuntSession) {
  const token = NodeCrypto.randomBytes(24).toString("base64url");
  sessions.set(token, s);
  return { url: `${base}/api/mcp/hunt`, token, close: () => sessions.delete(token) };
}

const reply = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
});

/**
 * One tool call with the gate Claude Code's canUseTool applies: Ask mode, input, and for a paid
 * tool the caps and the "ask above $x" approval.
 */
export async function gatedRun(t: HuntTool, raw: unknown, s: HuntSession) {
  const blocked = askBlocked(s.ctx, t.name);
  if (blocked) return reply(blocked, true);
  const args = z.object(t.shape).safeParse(raw);
  if (!args.success) return reply(`Invalid input: ${args.error.message}`, true);
  if (t.paid) {
    const price = t.price(args.data);
    const cap = capProblem(s.ctx, price);
    if (cap) {
      s.ctx.capHit(cap);
      return reply(cap, true);
    }
    const input = args.data as Record<string, unknown>;
    if (
      price > s.askOver() &&
      !(await s.approve({
        title: "paid lookup",
        body: `${String(input.endpoint ?? t.name)} · $${price}`,
        why: String(input.purpose ?? ""),
        costUsd: price,
      }))
    )
      return reply("The applicant declined this paid lookup. Continue with free sources.", true);
  }
  try {
    const r = await t.run(args.data, s.ctx);
    return reply(`${r.summary}\n\n${r.text}`);
  } catch (error) {
    return reply(`failed\n\n${String(error)}`, true);
  }
}

/** Serves one MCP request for the session its token opens. Stateless, like /api/mcp. */
export async function serveHunt(
  req: NodeHttp.IncomingMessage,
  res: NodeHttp.ServerResponse,
  body: unknown,
) {
  const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  const token = [...sessions.keys()].find((k) => sameToken(auth, k));
  const s = token ? sessions.get(token) : undefined;
  if (!s) {
    res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
    return;
  }
  const server = new McpServer({ name: "hunt", version: "1.0.0" });
  for (const t of s.tools)
    server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, (args) =>
      gatedRun(t, args, s),
    );
  const transport = new StreamableHTTPServerTransport();
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport as Transport);
  await transport.handleRequest(req, res, body);
}
