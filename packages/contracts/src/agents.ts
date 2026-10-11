// The coding agents a hunt can run on. Claude Code runs through its SDK; the others speak the
// Agent Client Protocol (agent/acp.ts). Each uses the copy installed and signed in on this machine.
import { z } from "zod";

export const AgentKind = z.enum(["claude", "codex", "opencode", "gemini", "copilot", "cursor"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const AGENT_NAME: Record<AgentKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  copilot: "Copilot",
  cursor: "Cursor",
};

export const AgentModel = z.object({ id: z.string(), name: z.string() });
export type AgentModel = z.infer<typeof AgentModel>;

/** One agent as Settings and the picker show it: whether it can run, and what it offers. */
export const AgentInfo = z.object({
  kind: AgentKind,
  /**
   * ready; signin: installed but not signed in; missing: not installed; unsupported: it can't
   * take getmyprof's tools; checking: the first look hasn't finished.
   */
  state: z.enum(["ready", "signin", "missing", "unsupported", "checking"]),
  /** One line under its name: "Signed in · 0.162.1". */
  detail: z.string(),
  /** The command that installs or signs it in, when it isn't ready. */
  fix: z.string(),
  binary: z.string(),
  models: z.array(AgentModel),
  /** Reasoning effort levels it takes; empty hides the chip. */
  efforts: z.array(z.string()),
  /** The model it picks when none is chosen. */
  defaultModel: z.string(),
});
export type AgentInfo = z.infer<typeof AgentInfo>;

/** A model's key in favorites and hidden lists: "codex:gpt-6-sol". */
export const modelKey = (agent: AgentKind, model: string) => `${agent}:${model}`;
