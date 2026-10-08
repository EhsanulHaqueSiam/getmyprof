import { describe, expect, it } from "vite-plus/test";
import { lint } from "../test/lint.ts";

describe("getmyprof/single-writer", () => {
  it("reports a direct write to gradhunt data", () => {
    expect(
      lint("single-writer", `fs.writeFileSync(join(dir, "professors.json"), body);`),
    ).toHaveLength(1);
    expect(lint("single-writer", "await rm(`${root}/drafts/x.md`);")).toHaveLength(1);
  });

  it("allows reading gradhunt data and writing anything else", () => {
    expect(lint("single-writer", `fs.readFileSync(join(dir, "professors.json"));`)).toEqual([]);
    expect(lint("single-writer", `fs.writeFileSync(join(tmp, "scout.py"), "");`)).toEqual([]);
  });
});

describe("getmyprof/no-forever-animation", () => {
  it("reports looping Tailwind classes and infinite keyframes", () => {
    expect(
      lint("no-forever-animation", `const el = <span className="size-3 animate-spin" />;`),
    ).toHaveLength(1);
    expect(lint("no-forever-animation", "const c = `x ${y} animate-pulse`;")).toHaveLength(1);
    expect(
      lint("no-forever-animation", `const s = { animation: "fade 1s infinite" };`),
    ).toHaveLength(1);
  });

  it("allows one-shot transitions", () => {
    expect(
      lint(
        "no-forever-animation",
        `const el = <div className="transition-opacity duration-150" />;`,
      ),
    ).toEqual([]);
    expect(
      lint("no-forever-animation", `const s = { animation: "fadeup 160ms ease-out both" };`),
    ).toEqual([]);
  });
});

describe("getmyprof/no-em-dash-copy", () => {
  it("reports em dashes in JSX text and strings", () => {
    expect(lint("no-em-dash-copy", "const el = <p>Funded — apply now</p>;")).toHaveLength(1);
    expect(lint("no-em-dash-copy", 'const label = "Done — settled";')).toHaveLength(1);
  });

  it("allows hyphens and plain copy", () => {
    expect(
      lint("no-em-dash-copy", "const el = <p>Funded: apply by Dec 1, fall-2027 intake.</p>;"),
    ).toEqual([]);
  });
});
