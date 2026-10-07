import type { McpServer, ThreadEvent } from "@gradcode/contracts";
import type { HuntTool, ToolContext } from "./tools.ts";

/** A file sent with a message: the model reads PDFs and images, text files inline. */
export type Attachment = { name: string; mime: string; base64: string };

/** What a provider reports back while a session runs. The runner turns these into thread state. */
export type SessionHooks = {
  emit: (event: ThreadEvent) => void;
  sessionId: (id: string) => void;
  turnStarted: () => void;
  turnEnded: (result: { durationMs: number; error: string | null }) => void;
  /** Resolves true when the user allows the paid call. */
  requestApproval: (ask: {
    title: string;
    body: string;
    why: string;
    costUsd: number;
  }) => Promise<boolean>;
  closed: () => void;
};

export type SessionStart = {
  threadId: string;
  resumeId: string | null;
  /** Resume as a new branch of that conversation (a forked thread's first message). */
  fork: boolean;
  firstText: string;
  firstFiles: Attachment[];
  systemPrompt: string;
  model: string;
  tools: HuntTool[];
  toolContext: ToolContext;
  askOver: number;
  hooks: SessionHooks;
  /** The user's own MCP servers; their tools ask first unless the server is trusted. */
  mcpServers: McpServer[];
};

/** A running agent conversation. `push` delivers a message: normally, after the next tool call, or now. */
export type AgentSession = {
  push: (text: string, priority?: "next" | "now", files?: Attachment[]) => void;
  interrupt: () => Promise<void>;
  close: () => void;
};

/** One agent backend: Claude through the Agent SDK, or the scripted fake for e2e. */
export type AgentProvider = { start: (s: SessionStart) => AgentSession };
