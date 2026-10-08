import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const SRC = NodeURL.fileURLToPath(new URL(".", import.meta.url));
const css = NodeFS.readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) =>
  f.endsWith(".css"),
);

// oxlint reads scripts, not stylesheets, so the CSS half of gradcode/no-forever-animation lives here.
describe("stylesheets", () => {
  it.each(css)("%s keeps the root at 16px, so rem sizes read as named", (file) => {
    const text = NodeFS.readFileSync(NodePath.join(SRC, file), "utf8");
    expect(text, "Set body copy on body (docs/internals/design.md, Type).").not.toMatch(
      /(^|[\s,}])html\s*(,[^{]*)?\{[^}]*font-size/,
    );
  });

  it.each(css)("%s has no animation that repeats forever", (file) => {
    const text = NodeFS.readFileSync(NodePath.join(SRC, file), "utf8");
    expect(text, "Use a one-shot transition (docs/internals/design.md, Motion).").not.toMatch(
      /\binfinite\b/,
    );
  });
});
