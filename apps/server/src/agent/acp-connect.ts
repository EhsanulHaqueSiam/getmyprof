// Starting an ACP agent: where each is installed, how it launches, and a probe that opens and
// closes a session to read its sign-in, models and effort levels. acp.ts runs the sessions.
import {
  type Client,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { AgentKind } from "@getmyprof/contracts";
import { type ChildProcess, spawn } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { type Readable, Writable } from "node:stream";
import { homeDir } from "../db.ts";

export type AcpKind = Exclude<AgentKind, "claude">;
export const ACP_KINDS: AcpKind[] = ["codex", "opencode", "gemini", "copilot", "cursor"];

/** How each agent starts, and the commands that install and sign it in. */
export const ACP_AGENTS: Record<
  AcpKind,
  { bin: string; run: string[]; install: string; login: string; env?: Record<string, string> }
> = {
  // Codex's own ACP adapter, which reads Codex's login.
  codex: {
    bin: "codex",
    run: ["npx", "-y", "@agentclientprotocol/codex-acp@2.2.2"],
    install: "npm i -g @openai/codex",
    login: "codex login",
  },
  opencode: {
    bin: "opencode",
    run: ["opencode", "acp"],
    install: "brew install opencode",
    login: "opencode auth login",
    // OpenCode edits files and runs commands without asking by default. Edits are denied; every
    // command asks, and decide() (acp.ts) refuses it. Denying bash outright breaks OpenCode's
    // own sign-in (2.0.26).
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { edit: "deny", bash: "ask" } }),
    },
  },
  gemini: {
    bin: "gemini",
    run: ["gemini", "--acp"],
    install: "npm i -g @google/gemini-cli",
    login: "gemini",
  },
  copilot: {
    bin: "copilot",
    run: ["copilot", "--acp"],
    install: "npm i -g @github/copilot",
    login: "copilot",
  },
  cursor: {
    bin: "cursor-agent",
    run: ["cursor-agent", "acp"],
    install: "curl https://cursor.com/install -fsS | bash",
    login: "cursor-agent login",
  },
};

/** PATH plus where agents install: an app opened from the Dock starts with a short PATH. */
const dirs = () => {
  const home = NodeOS.homedir();
  const extra = [
    ".local/bin",
    ".local/share/mise/shims",
    ".npm-global/bin",
    ".bun/bin",
    ".opencode/bin",
  ];
  return [
    ...new Set([
      ...(process.env.PATH ?? "").split(NodePath.delimiter),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      ...extra.map((d) => NodePath.join(home, d)),
    ]),
  ].filter(Boolean);
};

/** A command's full path, or "" when it isn't installed. */
export function onPath(bin: string) {
  const names = process.platform === "win32" ? [`${bin}.cmd`, `${bin}.exe`, bin] : [bin];
  for (const d of dirs())
    for (const n of names) if (NodeFS.existsSync(NodePath.join(d, n))) return NodePath.join(d, n);
  return "";
}

/** Each agent's own empty folder: nothing of the applicant's for it to read. */
export const workDir = (kind: AcpKind) => {
  const dir = NodePath.join(homeDir(), "work", kind);
  NodeFS.mkdirSync(dir, { recursive: true });
  return dir;
};

/** A process's output as the byte stream the ACP connection reads. */
const bytes = (out: Readable) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      out.on("data", (b: Buffer) => c.enqueue(new Uint8Array(b)));
      out.on("end", () => c.close());
      out.on("error", (e) => c.error(e));
    },
  });

export type Live = {
  conn: ClientSideConnection;
  child: ChildProcess;
  caps: Awaited<ReturnType<ClientSideConnection["initialize"]>>["agentCapabilities"];
};

/** Starts an agent and says hello. Fails with what it printed when it can't start. */
export async function connect(kind: AcpKind, cwd: string, client: Client): Promise<Live> {
  const [cmd = "", ...args] = ACP_AGENTS[kind].run;
  const path = onPath(cmd);
  if (!path) throw new Error(`${cmd} isn't installed`);
  const child = spawn(path, args, {
    cwd,
    env: { ...process.env, PATH: dirs().join(NodePath.delimiter), ...ACP_AGENTS[kind].env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let printed = "";
  child.stderr?.on("data", (b) => (printed = (printed + String(b)).slice(-1500)));
  const died = new Promise<never>((_, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`exited ${code}: ${printed.trim().slice(-300)}`)));
  });
  died.catch(() => undefined);
  if (!child.stdin || !child.stdout) throw new Error("no pipes");
  const conn = new ClientSideConnection(
    () => client,
    ndJsonStream(Writable.toWeb(child.stdin), bytes(child.stdout)),
  );
  const init = await Promise.race([
    conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    }),
    died,
  ]);
  return { conn, child, caps: init.agentCapabilities };
}

export const choices = (o: SessionConfigOption | undefined) =>
  o?.type === "select" ? o.options.flatMap((x) => ("options" in x ? x.options : [x])) : [];
export const option = (opts: SessionConfigOption[] | null | undefined, category: string) =>
  opts?.find((o) => o.category === category);

/** The agent said it needs signing in (ACP's -32000), however it worded it. */
export const needsLogin = (e: unknown) =>
  (typeof e === "object" && e !== null && "code" in e && e.code === -32000) ||
  /auth|log ?in|sign ?in|credential|api key/i.test(String(e));

/** Whether an agent can run here and what it offers: a session opened and closed at once. */
export async function probe(kind: AcpKind) {
  const cwd = workDir(kind);
  const nothing = { models: [], efforts: [], defaultModel: "" };
  let live: Live | undefined;
  try {
    live = await connect(kind, cwd, {
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      sessionUpdate: async () => undefined,
    });
    // The hunt tools arrive over HTTP MCP; an agent without it can't use them.
    if (!live.caps?.mcpCapabilities?.http) return { state: "unsupported" as const, ...nothing };
    const s = await live.conn.newSession({ cwd, mcpServers: [] });
    const model = option(s.configOptions, "model");
    return {
      state: "ready" as const,
      models: choices(model).map((m) => ({ id: m.value, name: m.name })),
      efforts: choices(option(s.configOptions, "thought_level"))
        .map((e) => e.value)
        .filter((v) => v !== "default" && v !== "none"),
      defaultModel: model?.type === "select" ? model.currentValue : "",
    };
  } catch (error) {
    if (needsLogin(error)) return { state: "signin" as const, ...nothing };
    throw error;
  } finally {
    live?.child.kill();
  }
}
