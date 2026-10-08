// The Claude Code binary the Agent SDK runs, and its sign-in. Dev and npm installs have the SDK's
// own platform package in node_modules. Release builds don't ship it (its license reserves
// redistribution), so this machine fetches that same package from registry.npmjs.org into
// GRADCODE_HOME on first need, checked against the sha512 the registry publishes. When it can't
// be fetched, a `claude` on PATH stands in.
import type { ClaudeBinary } from "@gradcode/contracts";
import * as NodeChild from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import { z } from "zod";
import { homeDir } from "../db.ts";

/** The SDK version a release build pins (`pnpm dist runtime` defines it); unset in dev. */
const PINNED = process.env.GRADCODE_CLAUDE_SDK;
const PACKAGE = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;

const resolveFrom = (base: string, id: string) => {
  try {
    return NodeModule.createRequire(base).resolve(id);
  } catch {
    return null;
  }
};
const isFile = (file: string) => NodeFS.statSync(file, { throwIfNoEntry: false })?.isFile();

/** The SDK's own copy: beside the SDK in dev, or an npm install's optional dependency. */
function sdkCopy() {
  const sdk = resolveFrom(import.meta.url, "@anthropic-ai/claude-agent-sdk");
  return (
    resolveFrom(import.meta.url, `${PACKAGE}/claude`) ??
    (sdk && resolveFrom(sdk, `${PACKAGE}/claude`))
  );
}

const fetched = (version: string) => NodePath.join(homeDir(), "claude", version, "claude");

function onPath() {
  for (const dir of (process.env.PATH ?? "").split(NodePath.delimiter))
    if (dir && isFile(NodePath.join(dir, "claude"))) return NodePath.join(dir, "claude");
  return null;
}

/** The binary when it's already here: the SDK's own copy, or the pinned version fetched before. */
export function findClaude() {
  return sdkCopy() ?? (PINNED && isFile(fetched(PINNED)) ? fetched(PINNED) : null);
}

const Meta = z.object({ dist: z.object({ tarball: z.string(), integrity: z.string() }) });

/** A GET that gives up when the server doesn't answer in 15 seconds, or its body stalls for 30. */
async function get(url: string) {
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const giveUpIn = (ms: number, why: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => abort.abort(new Error(why)), ms);
  };
  giveUpIn(15_000, `${new URL(url).host} didn't answer`);
  const r = await fetch(url, { signal: abort.signal }).catch((error: unknown) => {
    clearTimeout(timer);
    throw error instanceof Error && error.cause instanceof Error ? error.cause : error;
  });
  const body = r.body;
  if (!r.ok || !body) {
    clearTimeout(timer);
    throw new Error(`${url} answered ${r.status}`);
  }
  const stream = body;
  async function* chunks() {
    try {
      for await (const chunk of stream) {
        giveUpIn(30_000, "the download stalled");
        yield chunk;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { size: Number(r.headers.get("content-length") ?? 0), chunks };
}

async function download(version: string, progress: (percent: number) => void) {
  const meta = await get(`https://registry.npmjs.org/${PACKAGE}/${version}`);
  const { dist } = Meta.parse(
    JSON.parse(Buffer.concat(await Array.fromAsync(meta.chunks())).toString()),
  );
  const dir = NodePath.dirname(fetched(version));
  const work = NodePath.join(dir, `.part-${process.pid}`);
  NodeFS.rmSync(work, { recursive: true, force: true });
  NodeFS.mkdirSync(work, { recursive: true });
  try {
    const tgz = NodePath.join(work, "package.tgz");
    const { size, chunks } = await get(dist.tarball);
    const hash = NodeCrypto.createHash("sha512");
    let got = 0;
    async function* hashed() {
      for await (const chunk of chunks()) {
        hash.update(chunk);
        got += chunk.length;
        if (size) progress(Math.floor((got / size) * 100));
        yield chunk;
      }
    }
    await NodeStreamPromises.pipeline(
      NodeStream.Readable.from(hashed()),
      NodeFS.createWriteStream(tgz),
    );
    if (`sha512-${hash.digest("base64")}` !== dist.integrity)
      throw new Error("the download doesn't match the registry's checksum");
    const tar = NodeChild.spawnSync("tar", ["-xzf", tgz, "-C", work, "package/claude"]);
    if (tar.status !== 0) throw new Error(`tar: ${String(tar.stderr).slice(0, 200)}`);
    NodeFS.chmodSync(NodePath.join(work, "package/claude"), 0o755);
    NodeFS.renameSync(NodePath.join(work, "package/claude"), fetched(version));
  } finally {
    NodeFS.rmSync(work, { recursive: true, force: true });
  }
  // Versions an older gradcode fetched go.
  const all = NodePath.dirname(dir);
  for (const old of NodeFS.readdirSync(all))
    if (old !== version) NodeFS.rmSync(NodePath.join(all, old), { recursive: true, force: true });
  return fetched(version);
}

let status: ClaudeBinary = { state: "missing", error: "" };
let pending: Promise<string> | null = null;
const listeners = new Set<(s: ClaudeBinary) => void>();
const set = (next: ClaudeBinary) => {
  status = next;
  for (const l of listeners) l(next);
};

/** What Setup shows: here, downloading (and how far), or missing (and why). */
export const claudeStatus = (): ClaudeBinary => (findClaude() ? { state: "ready" } : status);

/**
 * The binary to run, fetched on first need. `onChange` hears each step (Setup, the CLI's
 * progress line). Rejects with a sentence a person can act on when there's no binary at all.
 */
export function ensureClaude(onChange?: (s: ClaudeBinary) => void) {
  const ready = findClaude();
  if (ready) return Promise.resolve(ready);
  if (onChange) listeners.add(onChange);
  pending ??= (async () => {
    try {
      if (!PINNED) throw new Error("this build doesn't name a version to fetch");
      set({ state: "downloading", percent: 0 });
      let shown = 0;
      const path = await download(PINNED, (percent) => {
        if (percent > shown) set({ state: "downloading", percent: (shown = percent) });
      });
      set({ state: "ready" });
      return path;
    } catch (error) {
      const fallback = onPath();
      if (fallback) {
        set({ state: "ready" });
        return fallback;
      }
      const reason = error instanceof Error ? error.message : String(error);
      const message = `Couldn't download Claude Code (${reason}). Check the connection and try again.`;
      set({ state: "missing", error: message });
      throw new Error(message, { cause: error });
    } finally {
      pending = null;
      listeners.clear();
    }
  })();
  return pending;
}

let login: NodeChild.ChildProcessWithoutNullStreams | null = null;

/**
 * Starts the binary's own sign-in (`claude auth login`). It opens the browser and finishes by
 * itself; this resolves with the page it printed, to open by hand. That page may show a code,
 * which goes back through `loginCode`. `onEnd` runs when the sign-in process exits.
 */
export async function startLogin(onEnd: () => void) {
  const binary = await ensureClaude();
  login?.kill();
  const child = NodeChild.spawn(binary, ["auth", "login"], { stdio: "pipe" });
  login = child;
  return new Promise<string>((resolve, reject) => {
    let out = "";
    const read = (chunk: Buffer) => {
      out += chunk.toString();
      const url = /(https:\/\/\S+)\s/.exec(out)?.[1];
      if (url) resolve(url);
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (login === child) login = null;
      reject(new Error(`Sign-in ended (${code}): ${out.trim().slice(-200)}`));
      onEnd();
    });
  });
}

/** Pastes the code the sign-in page showed into the waiting sign-in. */
export function loginCode(code: string) {
  if (!login) throw new Error("No sign-in is waiting for a code. Start it again.");
  login.stdin.write(`${code.trim()}\n`);
}
