// One live hunt, scored (eval-score.ts): who it found of those a top-tier hunt should, which of
// its facts check out on the pages it cited, and what it cost. Real Claude, real treg, a temp
// store: it spends your plan and a little treg money, so run it by hand, never in CI. No mailbox
// is connected, so nothing is ever sent.
//
//   node scripts/eval-hunt.ts --label after [--code <checkout>] [--treg] [--port 4320]
//   node scripts/eval-hunt.ts --label x --score <run.json>    re-score a saved run
//   node scripts/eval-hunt.ts --label x --from-home <dir>     score a run from its temp store
//
// --code runs another checkout's server (say main, for a before/after); --treg connects the
// treg login from `treg login` (~/.treg/config.json) with a $1 cap. Writes /tmp/gmp-eval-<label>.json.
import {
  type Method,
  type MethodInput,
  type MethodOutput,
  Methods,
} from "../packages/contracts/src/rpc.ts";
import { asArray, asRecord, text } from "../apps/server/src/sources.ts";
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { BENCH, type Run, score } from "./eval-score.ts";

const { values: opt } = parseArgs({
  options: {
    label: { type: "string", default: "run" },
    code: { type: "string", default: process.cwd() },
    port: { type: "string", default: "4320" },
    treg: { type: "boolean", default: false },
    score: { type: "string" },
    "from-home": { type: "string" },
    minutes: { type: "string", default: "60" },
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows = (v: unknown) => asArray(v).map(asRecord);

async function runHunt(): Promise<Run> {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `gmp-eval-${opt.label}-`));
  if (opt.treg) {
    const cfg = JSON.parse(
      NodeFS.readFileSync(NodePath.join(NodeOS.homedir(), ".treg/config.json"), "utf8"),
    );
    NodeFS.writeFileSync(NodePath.join(home, "treg.json"), JSON.stringify({ token: cfg.token }), {
      mode: 0o600,
    });
  }
  const log = NodeFS.openSync(NodePath.join(home, "server.log"), "a");
  const server = NodeChild.spawn(
    process.execPath,
    [NodePath.join(opt.code, "apps/server/src/bin.ts")],
    {
      env: {
        ...process.env,
        GETMYPROF_HOME: home,
        SERVER_PORT: opt.port,
        GRADHUNT_DIR: "/nonexistent",
        GETMYPROF_AGENT: "",
      },
      stdio: ["ignore", log, log],
    },
  );
  try {
    for (let i = 0; ; i++) {
      if (
        await fetch(`http://127.0.0.1:${opt.port}/api/health`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      if (i > 60) throw new Error(`the server didn't start: ${home}/server.log`);
      await sleep(500);
    }
    const ws = new WebSocket(`ws://127.0.0.1:${opt.port}/ws`);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    const waiting = new Map<number, (m: Record<string, unknown>) => void>();
    ws.addEventListener("message", (e) => {
      const m = asRecord(JSON.parse(String(e.data)));
      waiting.get(Number(m.id))?.(m);
    });
    let next = 0;
    const call = <M extends Method>(method: M, params: MethodInput<M>) =>
      new Promise<MethodOutput<M>>((resolve, reject) => {
        const id = ++next;
        waiting.set(id, (m) =>
          m.ok
            ? resolve(Methods[method].output.parse(m.result) as MethodOutput<M>)
            : reject(new Error(`${method}: ${JSON.stringify(m.error)}`)),
        );
        ws.send(JSON.stringify({ id, method, params }));
      });
    // Not setupDone: finishing setup would schedule the default loops, which run real turns.
    await call("settings.update", {
      detail: "std",
      treg: opt.treg,
      budget: { perThread: 1, perLoopRun: 1, perDay: 2, askOver: 1 },
      profileSource: "app",
      gradhunt: false,
    });
    await call("hunt.save", { name: "Eval: funded PhD", prefs: BENCH.prefs });
    const started = Date.now();
    const thread = await call("threads.create", {
      text: BENCH.message,
      scope: BENCH.schools.map((s) => ({ kind: "school" as const, name: s.name })),
    });
    let view = await call("threads.view", { id: thread.id });
    for (;;) {
      await sleep(15_000);
      view = await call("threads.view", { id: thread.id });
      const s = view.thread.status;
      process.stdout.write(
        `\r${opt.label}: ${s}, ${Math.round((Date.now() - started) / 60_000)} min, ${view.proposals.length} proposed, $${view.thread.spendUsd.toFixed(4)}   `,
      );
      if (s !== "working") break;
      if (Date.now() - started > Number(opt.minutes) * 60_000) {
        await call("threads.stop", { id: thread.id });
        break;
      }
    }
    console.log();
    ws.close();
    const tools: Record<string, number> = {};
    for (const e of view.events) if (e.type === "tool") tools[e.name] = (tools[e.name] ?? 0) + 1;
    const professors = view.proposals
      .filter((p) => p.kind === "add")
      .map((p) => ({
        name: p.recordName,
        university: p.university,
        sources: p.sources.join(" "),
        ...Object.fromEntries(p.changes.map((c) => [c.field, c.to])),
      }));
    const turns =
      NodeFS.readFileSync(NodePath.join(home, "server.log"), "utf8").match(/^turn .*$/gm) ?? [];
    const replies = view.events.flatMap((e) => (e.type === "assistant" ? [e.text] : []));
    return {
      label: opt.label,
      minutes: Math.round((Date.now() - started) / 60_000),
      status: view.thread.status,
      treg: opt.treg,
      spendUsd: view.thread.spendUsd,
      tools,
      turnLog: turns.at(-1) ?? "",
      professors,
      reply: replies.at(-1) ?? "",
    };
  } finally {
    server.kill();
  }
}

/** A run rebuilt from its temp store, when the script stopped before saving it. */
function fromHome(home: string): Run {
  const db = new DatabaseSync(NodePath.join(home, "getmyprof.sqlite"), { readOnly: true });
  const all = (sql: string) =>
    db
      .prepare(sql)
      .all()
      .map((r) => asRecord(JSON.parse(text(r.body))));
  const events = all("SELECT body FROM events ORDER BY seq");
  const tools: Record<string, number> = {};
  for (const e of events)
    if (e.type === "tool") tools[text(e.name)] = (tools[text(e.name)] ?? 0) + 1;
  const professors = all("SELECT body FROM proposals")
    .filter((p) => p.kind === "add")
    .map((p) => ({
      name: text(p.recordName),
      university: text(p.university),
      sources: asArray(p.sources).map(text).join(" "),
      ...Object.fromEntries(rows(p.changes).map((c) => [text(c.field), text(c.to)])),
    }));
  const spend = asRecord(db.prepare("SELECT sum(usd) AS usd FROM spend").get());
  const turns =
    NodeFS.readFileSync(NodePath.join(home, "server.log"), "utf8").match(/^turn .*$/gm) ?? [];
  return {
    label: opt.label,
    minutes: 0,
    status: "from store",
    treg: NodeFS.existsSync(NodePath.join(home, "treg.json")),
    spendUsd: Number(spend.usd ?? 0),
    tools,
    turnLog: turns.at(-1) ?? "",
    professors,
    reply: text(events.findLast((e) => e.type === "assistant")?.text),
  };
}

const file = (label: string) => `/tmp/gmp-eval-${label}.json`;
const run: Run = opt.score
  ? JSON.parse(NodeFS.readFileSync(opt.score, "utf8")).run
  : opt["from-home"]
    ? fromHome(opt["from-home"])
    : await runHunt();
// Saved before scoring, so a failing check never loses a run.
NodeFS.writeFileSync(file(run.label), JSON.stringify({ run }, null, 2));
const out = { run, report: await score(run) };
NodeFS.writeFileSync(file(run.label), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.report, null, 2));
console.log(`saved ${file(run.label)}`);
