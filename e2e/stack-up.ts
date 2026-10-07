import type { FullConfig } from "@playwright/test";

/** Fails the whole run in one line when the stack is down, instead of every spec timing out. */
export default async function stackUp(config: FullConfig) {
  const base = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:5174";
  const res = await fetch(new URL("/api/health", base)).catch((error: unknown) => error);
  if (res instanceof Response && res.ok) return;
  const why = res instanceof Response ? `HTTP ${res.status}` : String(res);
  throw new Error(`No gradcode stack at ${base} (${why}). Start it first: scripts/dev-local.sh up`);
}
