import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// oxlint ships inside vite-plus, so resolve it through vite-plus rather than hardcoding a path.
const oxlintPackage = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("vite-plus/package.json"),
).resolve("oxlint/package.json");
const OXLINT = NodePath.join(NodePath.dirname(oxlintPackage), "bin/oxlint");
const PLUGIN = NodeURL.fileURLToPath(new URL("../index.ts", import.meta.url));

type Diagnostic = { code: string; message: string };

/** Lints `source` as `filename` with only `getmyprof/<rule>` on. Returns that rule's messages. */
export function lint(rule: string, source: string, filename = "fixture.tsx"): string[] {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "getmyprof-oxlint-"));
  NodeFS.writeFileSync(NodePath.join(dir, filename), source);
  NodeFS.writeFileSync(
    NodePath.join(dir, ".oxlintrc.json"),
    JSON.stringify({ jsPlugins: [PLUGIN], rules: { [`getmyprof/${rule}`]: "error" } }),
  );
  const run = NodeChild.spawnSync(
    process.execPath,
    [OXLINT, "-c", ".oxlintrc.json", "--format", "json", filename],
    {
      cwd: dir,
      encoding: "utf8",
    },
  );
  const { diagnostics } = JSON.parse(run.stdout) as { diagnostics: Diagnostic[] };
  return diagnostics.filter((d) => d.code === `getmyprof(${rule})`).map((d) => d.message);
}
