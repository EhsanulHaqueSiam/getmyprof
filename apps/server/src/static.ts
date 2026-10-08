import * as NodeFS from "node:fs";
import type * as NodeHttp from "node:http";
import * as NodePath from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const isFile = (path: string) =>
  NodeFS.statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

/**
 * The built web app (apps/web/dist) on the server's own origin, for the desktop app and the
 * `gradcode` command (bin.ts turns it on with GRADCODE_WEB_DIR). Any other path gets index.html
 * so the router can take it; a missing hashed asset is a 404. Returns false for what it doesn't
 * serve: /api, /ws, and methods other than GET and HEAD.
 */
export function staticSite(dir: string) {
  const root = NodePath.resolve(dir);
  return (req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return false;
    }
    if (path.startsWith("/api/") || path === "/ws") return false;
    let file = NodePath.join(root, path);
    // A path that climbs out of the web folder (an encoded "..") never reads the disk.
    if (!file.startsWith(root + NodePath.sep) || !isFile(file)) {
      if (path.startsWith("/assets/")) {
        res.writeHead(404).end();
        return true;
      }
      file = NodePath.join(root, "index.html");
    }
    res.writeHead(200, {
      "content-type": TYPES[NodePath.extname(file)] ?? "application/octet-stream",
      "content-length": NodeFS.statSync(file).size,
      // Asset names carry their hash; index.html must be fresh so an update loads new assets.
      "cache-control": path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else NodeFS.createReadStream(file).pipe(res);
    return true;
  };
}
