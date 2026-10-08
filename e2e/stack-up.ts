import type { FullConfig } from "@playwright/test";

/**
 * Fails the whole run in one line when the stack is down, instead of every spec timing out, and
 * refuses a stack that runs the real agent: specs connect keys, send mail and restore backups, so
 * they only ever run against the scripted agent on throwaway data.
 */
export default async function stackUp(config: FullConfig) {
  const base = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:5174";
  const res = await fetch(new URL("/api/health", base)).catch((error: unknown) => error);
  if (!(res instanceof Response && res.ok)) {
    const why = res instanceof Response ? `HTTP ${res.status}` : String(res);
    throw new Error(
      `No gradcode stack at ${base} (${why}). Start it first: scripts/dev-local.sh up`,
    );
  }
  const health: unknown = await res.json();
  const scripted =
    typeof health === "object" && health !== null && "scripted" in health && health.scripted;
  if (!scripted)
    throw new Error(
      `The stack at ${base} runs the real agent, maybe on real data. e2e runs only against a scripted one: rm -rf /tmp/gc-e2e && GRADCODE_HOME=/tmp/gc-e2e GRADCODE_AGENT=fake scripts/dev-local.sh up (or point APP_URL at one on other ports).`,
    );
}
