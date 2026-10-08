import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { staticSite } from "./static.ts";

const web = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gc-static-"));
NodeFS.mkdirSync(NodePath.join(web, "assets"));
NodeFS.writeFileSync(NodePath.join(web, "index.html"), "<!doctype html>app");
NodeFS.writeFileSync(NodePath.join(web, "assets", "main-abc.js"), "console.log(1)");
NodeFS.writeFileSync(NodePath.join(NodePath.dirname(web), "gc-static-secret.txt"), "secret");

const site = staticSite(web);
const server = NodeHttp.createServer((req, res) => {
  if (!site(req, res)) res.writeHead(418).end();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
afterAll(() => server.close());

const get = async (path: string, method = "GET") => {
  const r = await fetch(base + path, { method });
  return {
    status: r.status,
    type: r.headers.get("content-type"),
    cache: r.headers.get("cache-control"),
    body: await r.text(),
  };
};

describe("the built web app on the server's origin", () => {
  it("serves files with their type, and hashed assets for good", async () => {
    expect(await get("/assets/main-abc.js")).toMatchObject({
      status: 200,
      type: "text/javascript; charset=utf-8",
      cache: "public, max-age=31536000, immutable",
      body: "console.log(1)",
    });
  });

  it("answers any page path with index.html, fresh every time", async () => {
    for (const path of ["/", "/t/thr_1", "/professors/mit.edu%3Ajane", "/settings?x=1"])
      expect(await get(path)).toMatchObject({
        status: 200,
        cache: "no-cache",
        body: "<!doctype html>app",
      });
  });

  it("404s a missing asset instead of handing back the page", async () => {
    expect((await get("/assets/gone-123.js")).status).toBe(404);
  });

  it("never reads outside the web folder", async () => {
    const r = await get("/..%2fgc-static-secret.txt");
    expect(r.body).not.toContain("secret");
  });

  it("leaves /api, /ws and writes to the server", async () => {
    expect((await get("/api/nope")).status).toBe(418);
    expect((await get("/ws")).status).toBe(418);
    expect((await get("/", "POST")).status).toBe(418);
  });
});
