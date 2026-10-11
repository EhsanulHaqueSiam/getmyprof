// Which coding agents this machine can run and what each offers, for Settings and the picker.
// Claude Code's state comes from binary.ts and health.ts; the ACP agents are asked (acp.ts probe),
// which also lists their models and effort levels. The look is cached; refreshAgents runs it again.
import type { AgentInfo, AgentKind, AppState, Settings } from "@getmyprof/contracts";
import { execFile } from "node:child_process";
import type { Db } from "../db.ts";
import { getThread, sessionId, setThreadAgent } from "../threads.ts";
import { ACP_AGENTS, ACP_KINDS, type AcpKind, onPath, probe } from "./acp-connect.ts";

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const looked = new Map<AcpKind, AgentInfo>();
let looking: Promise<void> | null = null;

const version = (bin: string) =>
  new Promise<string>((resolve) =>
    execFile(bin, ["--version"], { timeout: 5000 }, (_e, out) =>
      resolve(/\d+\.\d+(\.\d+)?/.exec(String(out))?.[0] ?? ""),
    ),
  );

async function look(kind: AcpKind): Promise<AgentInfo> {
  const a = ACP_AGENTS[kind];
  const binary = onPath(a.bin);
  const none = { kind, binary, models: [], efforts: [], defaultModel: "" };
  if (!binary) return { ...none, state: "missing", detail: "Not installed", fix: a.install };
  const v = await version(binary);
  try {
    const p = await probe(kind);
    if (p.state === "ready")
      return { ...none, ...p, detail: `Signed in${v ? ` · ${v}` : ""}`, fix: "" };
    if (p.state === "signin")
      return { ...none, state: "signin", detail: "Not signed in", fix: a.login };
    return { ...none, state: "unsupported", detail: "Can't take getmyprof's tools yet", fix: "" };
  } catch (error) {
    return {
      ...none,
      state: "signin",
      detail: `Couldn't start: ${String(error).slice(0, 140)}`,
      fix: a.login,
    };
  }
}

/** Looks at every ACP agent again; onDone tells clients the list changed. One look at a time. */
export function refreshAgents(onDone?: () => void) {
  looking ??= Promise.all(ACP_KINDS.map(async (k) => looked.set(k, await look(k)))).then(() => {
    looking = null;
    onDone?.();
  });
  return looking;
}

/** The scripted stack's agents: Claude Code and two more with made-up models, all free to run. */
const FAKE: AgentInfo[] = [
  {
    kind: "codex",
    state: "ready",
    detail: "Signed in · scripted",
    fix: "",
    binary: "",
    models: [
      { id: "gpt-6-sol", name: "GPT-6 Sol" },
      { id: "gpt-6-luna", name: "GPT-6 Luna" },
    ],
    efforts: ["low", "medium", "high"],
    defaultModel: "gpt-6-sol",
  },
  {
    kind: "opencode",
    state: "ready",
    detail: "Signed in · scripted",
    fix: "",
    binary: "",
    models: [{ id: "opencode/big-pickle", name: "Big Pickle" }],
    efforts: [],
    defaultModel: "opencode/big-pickle",
  },
];

/** Every agent as last seen, Claude Code first. */
export function agentList(claude: AppState["claude"], fake = false): AgentInfo[] {
  const first: AgentInfo = {
    kind: "claude",
    state: claude.binary.state !== "ready" ? "missing" : claude.signedIn ? "ready" : "signin",
    detail:
      claude.binary.state === "downloading"
        ? `Downloading · ${claude.binary.percent}%`
        : claude.signedIn
          ? `Signed in as ${claude.who}`
          : claude.binary.state === "ready"
            ? "Not signed in"
            : "Not downloaded yet",
    fix: "",
    binary: "",
    models: CLAUDE_MODELS,
    efforts: CLAUDE_EFFORTS,
    defaultModel: CLAUDE_MODELS[0]?.id ?? "",
  };
  const rest = fake
    ? ACP_KINDS.map((k) => FAKE.find((f) => f.kind === k) ?? missing(k))
    : ACP_KINDS.map(
        (k): AgentInfo =>
          looked.get(k) ?? {
            kind: k,
            state: "checking",
            detail: "Checking",
            fix: "",
            binary: "",
            models: [],
            efforts: [],
            defaultModel: "",
          },
      );
  return [first, ...rest];
}

const missing = (k: AcpKind): AgentInfo => ({
  kind: k,
  state: "missing",
  detail: "Not installed",
  fix: ACP_AGENTS[k].install,
  binary: "",
  models: [],
  efforts: [],
  defaultModel: "",
});

/** The model a thread on this agent runs: the wanted one when the agent has it, else its default. */
export function modelFor(agents: AgentInfo[], agent: AgentKind, wanted: string | null) {
  const a = agents.find((x) => x.kind === agent);
  if (!a?.models.length) return wanted ?? "";
  return wanted && a.models.some((m) => m.id === wanted)
    ? wanted
    : a.defaultModel || (a.models[0]?.id ?? "");
}

/**
 * The agent, model and effort a thread runs on. Its first message fixes them from Settings; a
 * thread from before agents could be picked already holds an SDK agent conversation.
 */
export function threadAgent(db: Db, threadId: string, install: Settings) {
  // Only the models matter here, and the SDK agent's list doesn't depend on its sign-in.
  const agents = agentList(
    { signedIn: true, who: "", binary: { state: "ready" } },
    process.env.GETMYPROF_AGENT === "fake",
  );
  const thread = getThread(db, threadId);
  const agent: AgentKind = thread?.agent ?? (sessionId(db, threadId) ? "claude" : install.agent);
  const mine = agent === install.agent;
  const model = modelFor(agents, agent, thread?.model ?? (mine ? install.model : null));
  const effort = thread?.effort ?? (mine ? install.effort : "");
  if (!thread?.agent) setThreadAgent(db, threadId, { agent, model, effort });
  return { agent, model, effort };
}
