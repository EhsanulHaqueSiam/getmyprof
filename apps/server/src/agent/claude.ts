import {
  createSdkMcpServer,
  query,
  tool,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ThreadEvent } from "@gradcode/contracts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { z } from "zod";
import { homeDir, now } from "../db.ts";
import type { AgentProvider, SessionStart } from "./provider.ts";
import { capProblem, type HuntTool } from "./tools.ts";

const IDLE_CLOSE_MS = 60_000;
const BUILTIN = ["WebSearch", "WebFetch"];
const mcpName = (t: HuntTool) => `mcp__hunt__${t.name}`;

/** An async queue the SDK reads user messages from, so messages can arrive mid-turn. */
function inbox() {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  return {
    push(m: SDKUserMessage) {
      items.push(m);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = items.shift();
        if (next) yield next;
        else if (ended) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

const userMessage = (text: string, priority?: "next" | "now"): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
  ...(priority ? { priority } : {}),
});

/** A work-log label for a tool call: short name plus the one detail that identifies it. */
export function describeTool(name: string, input: Record<string, unknown>) {
  const short = name.replace(/^mcp__hunt__/, "");
  const s = (v: unknown) => (v == null ? "" : String(v));
  if (name === "WebFetch")
    return { name: "fetch", detail: s(input.url).replace(/^https?:\/\/(www\.)?/, "") };
  if (name === "WebSearch") return { name: "search", detail: s(input.query) };
  if (short === "propose_professor")
    return { name: short, detail: `${s(input.name)} · ${s(input.university)}` };
  if (short === "draft_email")
    return { name: short, detail: `${s(input.touch)} · ${s(input.name)}` };
  if (short === "classify_reply") return { name: short, detail: s(input.replyClass) };
  if (short === "treg") return { name: `treg ${s(input.endpoint)}`, detail: s(input.purpose) };
  if (short === "nsf_awards" || short === "nih_awards")
    return {
      name: short,
      detail: [input.terms, input.university, input.pi].flat().filter(Boolean).map(s).join(" · "),
    };
  if (short === "openalex_author")
    return {
      name: short,
      detail: [input.name, input.university].filter(Boolean).map(s).join(" · "),
    };
  return { name: short, detail: JSON.stringify(input).slice(0, 80) };
}

const firstLine = (text: string) => text.split("\n")[0]?.slice(0, 80) ?? "";

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : ""))
      .join("\n");
  return "";
}

export const claudeProvider: AgentProvider = {
  start(s: SessionStart) {
    const { hooks, tools } = s;
    const input = inbox();
    const calls = new Map<string, { name: string; detail: string }>();
    let busy = false;
    let idleTimer: NodeJS.Timeout | undefined;

    const beginTurn = () => {
      clearTimeout(idleTimer);
      if (!busy) {
        busy = true;
        hooks.turnStarted();
      }
    };

    const server = createSdkMcpServer({
      name: "hunt",
      version: "1.0.0",
      tools: tools.map((t) =>
        tool(t.name, t.description, t.shape, async (args) => {
          try {
            const r = await t.run(args, s.toolContext);
            return { content: [{ type: "text" as const, text: `${r.summary}\n\n${r.text}` }] };
          } catch (error) {
            return {
              content: [{ type: "text" as const, text: `failed\n\n${String(error)}` }],
              isError: true,
            };
          }
        }),
      ),
    });

    const cwd = NodePath.join(homeDir(), "work");
    NodeFS.mkdirSync(cwd, { recursive: true });

    const q = query({
      prompt: input,
      options: {
        model: s.model,
        cwd,
        systemPrompt: s.systemPrompt,
        settingSources: [],
        tools: BUILTIN,
        allowedTools: [...BUILTIN, ...tools.filter((t) => !t.paid).map(mcpName)],
        mcpServers: { hunt: server },
        ...(s.resumeId ? { resume: s.resumeId } : {}),
        canUseTool: async (toolName, raw) => {
          const t = tools.find((x) => mcpName(x) === toolName);
          if (!t) return { behavior: "deny", message: `${toolName} isn't available in gradcode.` };
          const args = z.object(t.shape).safeParse(raw);
          if (!args.success)
            return { behavior: "deny", message: `Invalid input: ${args.error.message}` };
          const price = t.price(args.data);
          const cap = capProblem(s.toolContext, price);
          if (cap) return { behavior: "deny", message: cap };
          if (price <= s.askOver) return { behavior: "allow", updatedInput: raw };
          const ok = await hooks.requestApproval({
            title: "paid lookup",
            body: `${String(raw.endpoint)} · $${price}`,
            why: String(raw.purpose ?? ""),
            costUsd: price,
          });
          return ok
            ? { behavior: "allow", updatedInput: raw }
            : {
                behavior: "deny",
                message: "The applicant declined this paid lookup. Continue with free sources.",
              };
        },
      },
    });

    void (async () => {
      try {
        for await (const m of q) {
          if (m.type === "system" && m.subtype === "init") hooks.sessionId(m.session_id);
          if (m.type === "assistant") {
            beginTurn();
            m.message.content.forEach((block, i) => {
              if (block.type === "text" && block.text.trim())
                hooks.emit({
                  id: `${m.uuid}-${i}`,
                  at: now(),
                  type: "assistant",
                  text: block.text,
                });
              if (block.type === "tool_use") {
                const d = describeTool(block.name, (block.input ?? {}) as Record<string, unknown>);
                calls.set(block.id, d);
                hooks.emit({
                  id: block.id,
                  at: now(),
                  type: "tool",
                  ...d,
                  status: "running",
                  meta: "",
                  costUsd: 0,
                });
              }
            });
          }
          if (m.type === "user" && Array.isArray(m.message.content)) {
            for (const block of m.message.content) {
              if (typeof block !== "object" || block.type !== "tool_result") continue;
              const d = calls.get(block.tool_use_id);
              if (!d) continue;
              const text = resultText(block.content);
              const denied = block.is_error === true && /declined|cap|isn't available/.test(text);
              const event: ThreadEvent = {
                id: block.tool_use_id,
                at: now(),
                type: "tool",
                ...d,
                status: denied ? "denied" : block.is_error ? "error" : "done",
                meta:
                  d.name === "fetch" || d.name === "search"
                    ? block.is_error
                      ? "failed"
                      : "read"
                    : firstLine(text),
                costUsd: Number(
                  /\$(\d+(?:\.\d+)?)/.exec(d.name.startsWith("treg") ? firstLine(text) : "")?.[1] ??
                    0,
                ),
              };
              hooks.emit(event);
            }
          }
          if (m.type === "result") {
            busy = false;
            hooks.turnEnded({
              durationMs: m.duration_ms,
              error: m.subtype === "success" ? null : m.subtype.replaceAll("_", " "),
            });
            idleTimer = setTimeout(() => input.end(), IDLE_CLOSE_MS);
          }
        }
      } catch (error) {
        hooks.emit({
          id: `err-${Date.now()}`,
          at: now(),
          type: "system",
          text: `The agent stopped: ${String(error).slice(0, 300)}`,
        });
        if (busy) hooks.turnEnded({ durationMs: 0, error: "failed" });
      } finally {
        clearTimeout(idleTimer);
        hooks.closed();
      }
    })();

    beginTurn();
    input.push(userMessage(s.firstText));

    return {
      push(text, priority) {
        const wasBusy = busy;
        beginTurn();
        input.push(userMessage(text, wasBusy ? priority : undefined));
      },
      interrupt: async () => {
        await q.interrupt();
      },
      close: () => input.end(),
    };
  },
};
