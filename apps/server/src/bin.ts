import { ClientRequest, type ServerMessage } from "@gradcode/contracts";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import { WebSocketServer } from "ws";
import { importGradhunt } from "./adapters.ts";
import { claudeProvider } from "./agent/claude.ts";
import { fakeProvider } from "./agent/fake.ts";
import { fixtureSources } from "./agent/fixtures.ts";
import { createRunner } from "./agent/runner.ts";
import { realSources } from "./agent/tools.ts";
import { createBus } from "./bus.ts";
import { openDb } from "./db.ts";
import { health } from "./health.ts";
import { dueLoops, fillPlaceholders, hookLoop, listLoops, markRan } from "./loops.ts";
import { fakeMailer, imapMailer } from "./outreach/mail.ts";
import { createOutreach } from "./outreach/service.ts";
import { serveMcp } from "./mcp.ts";
import { createHandlers, dispatch } from "./rpc.ts";
import { getSettings } from "./state.ts";
import { createThread, expireApprovals, getThread, settleStale } from "./threads.ts";
import { documentPath, listDocuments } from "./vault.ts";

const PORT = Number(process.env.SERVER_PORT ?? 4311);
const fake = process.env.GRADCODE_AGENT === "fake";

const db = openDb();
expireApprovals(db);
settleStale(db);
if (getSettings(db).gradhunt) importGradhunt(db);

const bus = createBus();
const sources = fake ? fixtureSources : realSources;
const runner = createRunner({
  db,
  bus,
  provider: fake ? fakeProvider() : claudeProvider,
  sources,
  signAs: () => outreach.status().name,
});
// The fake agent pairs with a fake mailbox: nothing leaves this machine in tests or e2e.
const sandboxMail = fakeMailer();
const outreach = createOutreach({
  db,
  bus,
  runner,
  mailerFor: fake ? () => sandboxMail : imapMailer,
});

/**
 * Starts one loop run: in a fresh thread, or back in the loop's one thread. A webhook's request
 * body fills the {{body.path}} placeholders in the instructions.
 */
function startLoop(id: string, body: unknown = null) {
  const loop = listLoops(db).find((l) => l.id === id);
  if (!loop) throw new Error(`No loop ${id}`);
  const ranAt = new Date();
  const day = ranAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const same = loop.reportTo === "same" && loop.threadId ? getThread(db, loop.threadId) : null;
  const threadId =
    same?.id ??
    createThread(db, loop.reportTo === "same" ? loop.name : `${loop.name} · ${day}`, loop.id).id;
  markRan(db, loop, ranAt, threadId);
  const text = fillPlaceholders(loop.instructions, body);
  // A repeat of the same instructions in one thread shows as a short label; a webhook's filled
  // text differs every call, so it shows in full.
  const repeat = same && loop.schedule.kind !== "webhook";
  runner.send(threadId, text, "send", repeat ? `${loop.name} · run ${day}` : text);
  bus.push({ type: "changed", what: "loops" });
  return getThread(db, threadId)!;
}

/** A request body up to 1 MB, parsed as JSON when it is JSON, else the raw text. */
function readBody(req: NodeHttp.IncomingMessage) {
  return new Promise<unknown>((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(raw);
      }
    });
  });
}

const handlers = createHandlers({ db, bus, runner, sources, fake, startLoop, outreach });

// Loops and the send queue run on the minute, mail syncs every 3 minutes, stale threads settle
// hourly. Each is a cheap read when there's nothing to do.
setInterval(() => {
  for (const loop of dueLoops(db)) startLoop(loop.id);
  void outreach.tick();
}, 60_000);
setInterval(() => void outreach.sync(), 180_000);
setInterval(() => settleStale(db), 3_600_000);

// Loopback only. Vite proxies /api and /ws here, and `scripts/dev-local.sh share` puts Vite on
// the tailnet, so every client sees one origin (docs/internals/overview.md).
const server = NodeHttp.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(health()));
    return;
  }
  // A webhook loop's trigger: POST JSON to /api/hooks/<token>; the body fills its placeholders.
  const hook = /^\/api\/hooks\/([\w-]+)$/.exec(req.url ?? "");
  if (hook && req.method === "POST") {
    const loop = hookLoop(db, hook[1] ?? "");
    if (!loop) {
      res.writeHead(404).end();
      return;
    }
    void readBody(req).then((body) => {
      const t = startLoop(loop.id, body);
      res
        .writeHead(202, { "content-type": "application/json" })
        .end(JSON.stringify({ threadId: t.id }));
    });
    return;
  }
  // gradcode's own MCP endpoint for other agents (stateless streamable HTTP: POST only).
  if (req.url === "/api/mcp") {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }
    void readBody(req)
      .then((body) => serveMcp(db, handlers, req, res, body))
      .catch((error: unknown) => {
        if (!res.headersSent) res.writeHead(500).end(String(error));
      });
    return;
  }
  // A vault document, opened in a tab. Sandboxed, so an uploaded HTML file can't run on our origin.
  const file = /^\/api\/files\/([\w-]+)$/.exec(req.url ?? "");
  const doc = file && req.method === "GET" ? listDocuments(db).find((d) => d.id === file[1]) : null;
  if (doc && NodeFS.existsSync(documentPath(doc.id))) {
    res.writeHead(200, {
      "content-type": doc.mime,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
    });
    NodeFS.createReadStream(documentPath(doc.id)).pipe(res);
    return;
  }
  res.writeHead(404).end();
});

new WebSocketServer({ server, path: "/ws", maxPayload: 32 * 1024 * 1024 }).on(
  "connection",
  (ws) => {
    const send = (message: ServerMessage) => ws.send(JSON.stringify(message));
    const remove = bus.add(send);
    ws.on("close", remove);
    ws.on("message", async (data) => {
      let req: ClientRequest;
      try {
        req = ClientRequest.parse(JSON.parse(String(data)));
      } catch {
        return;
      }
      try {
        send({
          type: "reply",
          id: req.id,
          ok: true,
          result: await dispatch(handlers, req.method, req.params),
        });
      } catch (error) {
        send({
          type: "reply",
          id: req.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    send({ type: "hello" });
  },
);

server.listen(PORT, "127.0.0.1", () =>
  console.log(`gradcode server on http://127.0.0.1:${PORT}${fake ? " (fake agent)" : ""}`),
);
