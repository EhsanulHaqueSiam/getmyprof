// Agents that speak the Agent Client Protocol: Codex, OpenCode, Gemini CLI, Copilot and Cursor,
// started from the copy installed and signed in here. Each session gets getmyprof's hunt tools
// over MCP (mcp-hunt.ts) and is kept to them: whatever edits, deletes, moves or runs a command is
// refused. acp-connect.ts starts them; agents.ts shows which can run and their models.
import type {
  Client,
  ContentBlock,
  McpServer as AcpMcpServer,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { AGENT_NAME, type McpServer } from "@getmyprof/contracts";
import { now } from "../db.ts";
import { asRecord } from "../sources.ts";
import {
  ACP_AGENTS,
  type AcpKind,
  choices,
  connect,
  type Live,
  needsLogin,
  option,
  workDir,
} from "./acp-connect.ts";
import { describeTool } from "./claude.ts";
import { openHuntSession } from "./mcp-hunt.ts";
import type { AgentProvider, Attachment } from "./provider.ts";

const IDLE_CLOSE_MS = 60_000;

const firstLine = (text: string) => text.split("\n")[0]?.slice(0, 80) ?? "";
const toolText = (u: ToolCallUpdate) =>
  (u.content ?? [])
    .map((c) => (c.type === "content" && c.content.type === "text" ? c.content.text : ""))
    .join("\n");

/** A work-log label: a hunt tool by its own name, the agent's web reads as fetch and search. */
function describe(u: ToolCallUpdate, mine: Set<string>) {
  const raw = asRecord(u.rawInput);
  const label = u.name ?? u.title ?? "";
  const name =
    typeof raw.tool === "string" && mine.has(raw.tool)
      ? raw.tool
      : [...mine].find((n) => label === n || new RegExp(`[_/.:\\s]${n}$`).test(label));
  if (name) {
    return describeTool(`mcp__hunt__${name}`, raw.arguments ? asRecord(raw.arguments) : raw);
  }
  if (u.kind === "fetch") return { name: "fetch", detail: String(raw.url ?? label).slice(0, 80) };
  if (u.kind === "search") return { name: "search", detail: String(raw.query ?? label) };
  return { name: label.slice(0, 40) || (u.kind ?? "tool"), detail: "" };
}

/**
 * Hunt tools and web reads go ahead; editing, deleting, moving or running anything is refused.
 * Some agents ask about a tool call by id alone (Codex: kind "execute", no name), so `known` is
 * what its earlier tool_call said it was.
 */
export function decide(
  p: RequestPermissionRequest,
  mine: Set<string>,
  known?: { name: string; detail: string },
) {
  const d = known ?? describe(p.toolCall, mine);
  const ok =
    mine.has(d.name.split(" ")[0] ?? "") ||
    ["fetch", "search", "think"].includes(p.toolCall.kind ?? "");
  const pick =
    p.options.find((o) => o.kind === (ok ? "allow_once" : "reject_once")) ??
    p.options.find((o) => o.kind === (ok ? "allow_always" : "reject_always"));
  return {
    outcome: pick
      ? { outcome: "selected" as const, optionId: pick.optionId }
      : { outcome: "cancelled" as const },
  };
}

/** A message and its files as ACP content: images when the agent reads them, text inline. */
const blocks = (text: string, files: Attachment[], images: boolean): ContentBlock[] => [
  ...files.map((f): ContentBlock =>
    images && f.mime.startsWith("image/")
      ? { type: "image", data: f.base64, mimeType: f.mime }
      : {
          type: "text",
          text: /^text\/|json|xml|csv/.test(f.mime)
            ? `Attached ${f.name}:\n${Buffer.from(f.base64, "base64").toString("utf8").slice(0, 100_000)}`
            : `Attached ${f.name} (a file this agent can't read directly)`,
        },
  ),
  { type: "text", text },
];

/** The user's own MCP servers this agent can take: trusted ones, since it asks nothing first. */
const ownServers = (servers: McpServer[], http: boolean): AcpMcpServer[] =>
  servers
    .filter((m) => m.trusted && m.name !== "hunt")
    .flatMap((m): AcpMcpServer[] =>
      m.transport === "http"
        ? http
          ? [{ type: "http", name: m.name, url: m.url, headers: [] }]
          : []
        : [{ name: m.name, command: m.command, args: m.args, env: [] }],
    );

export const acpProvider = (kind: AcpKind): AgentProvider => ({
  start(s) {
    const { hooks } = s;
    const a = ACP_AGENTS[kind];
    const cwd = workDir(kind);
    const mine = new Set(s.tools.map((t) => t.name));
    const door = openHuntSession({
      tools: s.tools,
      ctx: s.toolContext,
      askOver: s.askOver,
      approve: hooks.requestApproval,
    });
    const queue: { text: string; files: Attachment[] }[] = [];
    const calls = new Map<string, { name: string; detail: string }>();
    let live: Live | undefined;
    let sessionId = "";
    let config: SessionConfigOption[] = [];
    let replaying = false;
    let busy = false;
    let ended = false;
    let fresh = !s.resumeId;
    let idle: NodeJS.Timeout | undefined;
    let said = { id: "", text: "" };

    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(idle);
      door.close();
      live?.child.kill();
      hooks.closed();
    };

    // Text arrives in pieces; it goes into the thread whole, before the next tool or at the end.
    const flush = () => {
      if (said.text.trim())
        hooks.emit({ id: said.id, at: now(), type: "assistant", text: said.text });
      said = { id: "", text: "" };
    };

    const finish = (u: ToolCallUpdate) => {
      const d = calls.get(u.toolCallId) ?? describe(u, mine);
      calls.delete(u.toolCallId);
      const text = toolText(u);
      const failed = u.status === "failed";
      hooks.emit({
        id: u.toolCallId,
        at: now(),
        type: "tool",
        ...d,
        status: failed && /declined|cap/.test(text) ? "denied" : failed ? "error" : "done",
        meta:
          d.name === "fetch" || d.name === "search"
            ? failed
              ? "failed"
              : "free"
            : firstLine(text),
        costUsd: Number(
          /\$(\d+(?:\.\d+)?)/.exec(d.name.startsWith("treg") ? firstLine(text) : "")?.[1] ?? 0,
        ),
      });
    };

    const onUpdate = (u: SessionUpdate) => {
      if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
        if (said.id && u.messageId && u.messageId !== said.id) flush();
        said = {
          id: said.id || u.messageId || `acp-${Date.now()}`,
          text: said.text + u.content.text,
        };
      } else if (u.sessionUpdate === "tool_call") {
        flush();
        const d = describe(u, mine);
        calls.set(u.toolCallId, d);
        hooks.emit({
          id: u.toolCallId,
          at: now(),
          type: "tool",
          ...d,
          status: "running",
          meta: "",
          costUsd: 0,
        });
        if (u.status === "completed" || u.status === "failed") finish(u);
      } else if (
        u.sessionUpdate === "tool_call_update" &&
        (u.status === "completed" || u.status === "failed") &&
        calls.has(u.toolCallId)
      )
        finish(u);
    };

    const client: Client = {
      requestPermission: async (p) => decide(p, mine, calls.get(p.toolCall.toolCallId)),
      sessionUpdate: async (n) => {
        // A resumed session replays its history first; the thread already has it.
        if (!replaying && n.sessionId === sessionId) onUpdate(n.update);
      },
    };

    /** Sets a select option when the agent offers that value; read-only mode where there is one. */
    const set = async (category: string, value: string) => {
      const o = option(config, category);
      if (!live || !o || !value || !choices(o).some((c) => c.value === value)) return;
      const r = await live.conn.setSessionConfigOption({ sessionId, configId: o.id, value });
      config = r.configOptions ?? config;
    };

    const ready = (async () => {
      live = await connect(kind, cwd, client);
      live.child.on("exit", end);
      const http = live.caps?.mcpCapabilities?.http === true;
      if (!http) throw new Error("this agent can't take getmyprof's tools (it has no HTTP MCP)");
      const mcpServers: AcpMcpServer[] = [
        {
          type: "http",
          name: "hunt",
          url: door.url,
          headers: [{ name: "Authorization", value: `Bearer ${door.token}` }],
        },
        ...ownServers(s.mcpServers, http),
      ];
      if (s.resumeId && live.caps?.loadSession) {
        replaying = true;
        try {
          if (s.fork && live.caps.sessionCapabilities?.fork) {
            const r = await live.conn.unstable_forkSession({
              sessionId: s.resumeId,
              cwd,
              mcpServers,
            });
            sessionId = r.sessionId;
            config = r.configOptions ?? [];
          } else {
            const r = await live.conn.loadSession({ sessionId: s.resumeId, cwd, mcpServers });
            sessionId = s.resumeId;
            config = r.configOptions ?? [];
          }
        } catch {
          // The agent no longer has it: start over, with the instructions again.
          sessionId = "";
        } finally {
          replaying = false;
        }
      }
      if (!sessionId) {
        const r = await live.conn.newSession({ cwd, mcpServers });
        sessionId = r.sessionId;
        config = r.configOptions ?? [];
        fresh = true;
      }
      hooks.sessionId(sessionId);
      await set("mode", "read-only");
      await set("model", s.model);
      await set("thought_level", s.effort);
    })();
    ready.catch(() => undefined);

    const problem = (e: unknown) =>
      needsLogin(e)
        ? `${AGENT_NAME[kind]} isn't signed in. Run \`${a.login}\` in a terminal, then send this again.`
        : /isn't installed|ENOENT/.test(String(e))
          ? `${AGENT_NAME[kind]} isn't installed here. Install it with \`${a.install}\`, or pick another agent.`
          : `The agent stopped: ${String(e).slice(0, 300)}`;

    const pump = async (): Promise<void> => {
      if (busy || ended) return;
      const next = queue.shift();
      if (!next) {
        idle = setTimeout(end, IDLE_CLOSE_MS);
        return;
      }
      clearTimeout(idle);
      busy = true;
      hooks.turnStarted();
      const started = Date.now();
      let error: string | null = null;
      try {
        await ready;
        if (!live) throw new Error("not started");
        // ACP has no system prompt: a new conversation gets the instructions with its first message.
        const text = fresh
          ? `<instructions>\n${s.systemPrompt}\n</instructions>\n\n${next.text}`
          : next.text;
        fresh = false;
        const r = await live.conn.prompt({
          sessionId,
          prompt: blocks(text, next.files, live.caps?.promptCapabilities?.image === true),
        });
        if (r.stopReason !== "end_turn" && r.stopReason !== "cancelled")
          error = r.stopReason.replaceAll("_", " ");
      } catch (e) {
        console.log(`${kind} turn failed: ${String(e).slice(0, 300)}`);
        error = "failed";
        hooks.emit({ id: `err-${Date.now()}`, at: now(), type: "system", text: problem(e) });
      }
      flush();
      busy = false;
      hooks.turnEnded({ durationMs: Date.now() - started, error });
      if (error === "failed" && !sessionId) end();
      else void pump();
    };

    queue.push({ text: s.firstText, files: s.firstFiles });
    void pump();

    return {
      push(text, priority, files = []) {
        if (priority === "now" && busy) {
          queue.unshift({ text, files });
          if (live && sessionId) void live.conn.cancel({ sessionId });
        } else queue.push({ text, files });
        void pump();
      },
      interrupt: async () => {
        if (live && sessionId) await live.conn.cancel({ sessionId });
      },
      setModel(model, effort) {
        void ready
          .then(() => set("model", model))
          .then(() => set("thought_level", effort))
          .catch(() => undefined);
      },
      close: end,
    };
  },
});
