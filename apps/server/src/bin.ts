import { ClientRequest, type ServerMessage } from "@gradcode/contracts";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { importGradhunt, profileFacts } from "./adapters.ts";
import { claudeProvider } from "./agent/claude.ts";
import { fakeProvider } from "./agent/fake.ts";
import { fixtureSources } from "./agent/fixtures.ts";
import { createRunner } from "./agent/runner.ts";
import { realSources } from "./agent/tools.ts";
import { createBus } from "./bus.ts";
import { openDb } from "./db.ts";
import { health } from "./health.ts";
import { dueLoops, fillPlaceholders, hookLoop, listLoops, markRan } from "./loops.ts";
import { fakeMailer, fakeTokenEndpoint, imapMailer } from "./outreach/mail.ts";
import { createOutreach } from "./outreach/service.ts";
import { exportAll, importAll } from "./backup.ts";
import { serveMcp } from "./mcp.ts";
import { refreshVault } from "./okf.ts";
import { createHandlers, dispatch } from "./rpc.ts";
import { getSettings } from "./state.ts";
import { dueReminders, markReminded } from "./reminders.ts";
import { createThread, expireApprovals, getThread, settleStale } from "./threads.ts";
import { documentPath, listDocuments, writingBrief } from "./vault.ts";

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
  signIn: { port: PORT, tokenFetch: fake ? fakeTokenEndpoint : fetch, scripted: fake },
});

/** A one-line page for the end of a mailbox sign-in that has nowhere to send the browser back. */
const plainPage = (text: string) =>
  `<!doctype html><meta charset="utf-8"><title>gradcode</title><p>${text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))}</p>`;

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

/**
 * Whether a request may act on this app. A browser always sends Origin; it must be the app's own
 * page (the host it was reached on, or the tailnet), so another site the user visits can't drive
 * the socket or restore a backup. Tools without a browser send no Origin.
 */
function sameSite(req: NodeHttp.IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === req.headers.host || o.hostname.endsWith(".ts.net");
  } catch {
    return false;
  }
}

/** A request body up to `limit` bytes, parsed as JSON when it is JSON, else the raw text. */
function readBody(req: NodeHttp.IncomingMessage, limit = 1_000_000) {
  return new Promise<unknown>((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
      if (raw.length > limit) req.destroy();
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

// The Vault's OKF bundle on disk and its search index follow the store, a moment after a change.
let vaultTimer: NodeJS.Timeout | undefined;
const refreshSoon = () => {
  clearTimeout(vaultTimer);
  vaultTimer = setTimeout(() => {
    try {
      refreshVault(db);
    } catch (error) {
      console.error(`vault bundle: ${String(error).slice(0, 200)}`);
    }
  }, 2000);
};
bus.add((m) => {
  if (m.type === "changed" && ["vault", "state", "records"].includes(m.what)) refreshSoon();
});
refreshSoon();

const handlers = createHandlers({ db, bus, runner, sources, fake, startLoop, outreach });

// Loops and the send queue run on the minute, mail syncs every 3 minutes, stale threads settle
// hourly. Each is a cheap read when there's nothing to do.
setInterval(() => {
  for (const loop of dueLoops(db)) startLoop(loop.id);
  void outreach.tick();
  remindRecommenders();
}, 60_000);

/** Recommenders still owing a letter get a drafted reminder 14 and 3 days before the deadline. */
function remindRecommenders() {
  const due = dueReminders(db);
  for (const r of due) {
    const brief = writingBrief(db, profileFacts(db), {
      kind: "note",
      programId: null,
      scholarshipId: null,
      basedOn: null,
      about: r.about,
    });
    runner.send(createThread(db, brief.threadTitle).id, brief.text, "send", brief.threadTitle);
  }
  if (due.length)
    markReminded(
      db,
      due.map((r) => r.key),
    );
}
setInterval(() => void outreach.sync(), 180_000);
setInterval(() => settleStale(db), 3_600_000);

// Loopback only. Vite proxies /api and /ws here, and `scripts/dev-local.sh share` puts Vite on
// the tailnet, so every client sees one origin (docs/internals/overview.md).
const server = NodeHttp.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(health()));
    return;
  }
  // The mailbox provider sends the browser back here after the applicant signs in.
  if (req.method === "GET" && req.url?.startsWith("/api/oauth/callback?")) {
    const q = new URL(req.url, "http://127.0.0.1").searchParams;
    const page = (status: number, text: string) =>
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(plainPage(text));
    if (q.get("error")) {
      page(400, `Sign-in didn't finish: ${q.get("error")}. Start it again from Settings.`);
      return;
    }
    void outreach
      .finishSignIn(q.get("state") ?? "", q.get("code") ?? "")
      .then((returnTo) =>
        returnTo
          ? res.writeHead(302, { location: returnTo }).end()
          : page(200, "Your mailbox is connected. Close this tab and go back to gradcode."),
      )
      .catch((error: unknown) =>
        page(400, `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`),
      );
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
  // A full backup: GET downloads everything, POST restores one (up to 300 MB).
  if (req.url === "/api/backup" && !sameSite(req)) {
    res.writeHead(403).end();
    return;
  }
  if (req.url === "/api/backup") {
    if (req.method === "GET") {
      res
        .writeHead(200, {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="gradcode-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        })
        .end(JSON.stringify(exportAll(db)));
      return;
    }
    if (req.method === "POST") {
      void readBody(req, 300_000_000).then((body) => {
        try {
          const counts = importAll(db, body);
          bus.push({ type: "changed", what: "state" });
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
        } catch (error) {
          res
            .writeHead(400)
            .end(error instanceof Error ? error.message.slice(0, 300) : "bad backup");
        }
      });
      return;
    }
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
  // A vault document, opened in a tab or the Vault's Preview. Sandboxed, so an uploaded HTML or SVG
  // file can't run on our origin; a PDF goes without it, because Chrome won't show a PDF in a
  // sandboxed frame, and nosniff keeps anything else from being read as a page.
  const file = /^\/api\/files\/([\w-]+)$/.exec(req.url ?? "");
  const doc =
    file && (req.method === "GET" || req.method === "HEAD")
      ? listDocuments(db).find((d) => d.id === file[1])
      : null;
  if (doc && NodeFS.existsSync(documentPath(doc.id))) {
    res.writeHead(200, {
      "content-type": doc.mime,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      ...(doc.mime === "application/pdf" ? {} : { "content-security-policy": "sandbox" }),
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else NodeFS.createReadStream(documentPath(doc.id)).pipe(res);
    return;
  }
  res.writeHead(404).end();
});

new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 32 * 1024 * 1024,
  // The socket can do anything the app can, so only the app's own pages may open it.
  verifyClient: ({ req }: { req: NodeHttp.IncomingMessage }) => sameSite(req),
}).on("connection", (ws) => {
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
        // A bad input reads as its field and rule ("customer: letters, digits..."), not zod's JSON.
        error:
          error instanceof z.ZodError
            ? error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  });
  send({ type: "hello" });
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`gradcode server on http://127.0.0.1:${PORT}${fake ? " (fake agent)" : ""}`),
);
