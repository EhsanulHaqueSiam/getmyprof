import type { ServerMessage } from "@gradcode/contracts";
import * as NodeHttp from "node:http";
import { WebSocketServer } from "ws";
import { health } from "./health.ts";

const PORT = Number(process.env.SERVER_PORT ?? 4311);

// Loopback only. Vite proxies /api and /ws here, and `scripts/dev-local.sh share` puts
// Vite on the tailnet, so every client sees one origin (docs/internals/overview.md).
const server = NodeHttp.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(health()));
    return;
  }
  res.writeHead(404).end();
});

const send = (ws: { send: (data: string) => void }, message: ServerMessage) =>
  ws.send(JSON.stringify(message));

new WebSocketServer({ server, path: "/ws" }).on("connection", (ws) => send(ws, { type: "hello" }));

server.listen(PORT, "127.0.0.1", () => console.log(`gradcode server on http://127.0.0.1:${PORT}`));
