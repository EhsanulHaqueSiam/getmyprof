import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const IGNORE = [
  "dist",
  "node_modules",
  "pnpm-lock.yaml",
  "**/routeTree.gen.ts",
  "docs/mocks/**",
  "test-results",
  "playwright-report",
  "evidence",
];

/** Layering: the server and the web app only meet in packages/contracts. */
const crossImport = (other: "web" | "server") => [
  "error",
  {
    patterns: [
      {
        group: [
          `@gradcode/${other}`,
          `@gradcode/${other}/*`,
          `**/apps/${other}/**`,
          `**/${other}/src/**`,
        ],
        message: `apps/${other === "web" ? "server" : "web"} can't import apps/${other}. Put the shared type in packages/contracts and import it from both.`,
      },
    ],
  },
];

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
  // Formatter only on commit. Lint, typecheck, tests and e2e run in /verify.
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: IGNORE,
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: IGNORE,
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: ["./oxlint-plugin-gradcode/index.ts", "@shadcn/lint"],
    settings: { shadcn: { ui: "~/components/ui" } },
    categories: { correctness: "warn", suspicious: "warn", perf: "warn" },
    rules: {
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "unicorn/consistent-function-scoping": "off",
      "eslint/no-await-in-loop": "off",
      "oxc/no-map-spread": "off",
      // Effects keyed on a version counter, and drafts synced from the store, are deliberate here.
      "react/exhaustive-effect-dependencies": "off",
      "react/set-state-in-effect": "off",
      "typescript/no-explicit-any": "error",
      "eslint/max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "gradcode/single-writer": "error",
      "gradcode/no-forever-animation": "error",
    },
    overrides: [
      {
        files: ["apps/web/src/**"],
        rules: {
          "eslint/no-restricted-imports": crossImport("server"),
          "gradcode/no-em-dash-copy": "error",
          // Every class must be one Tailwind generates, and colors come from theme tokens.
          "shadcn/no-unknown-classes": "error",
          "shadcn/no-raw-colors": "error",
        },
      },
      {
        // Vendored under MIT (see components/ui/LICENSE there). Keep it identical to upstream.
        files: ["apps/web/src/components/ui/**"],
        rules: { "react/immutability": "off" },
      },
      {
        files: ["apps/server/src/**"],
        rules: { "eslint/no-restricted-imports": crossImport("web") },
      },
      {
        // The rule tests hold the forbidden patterns as fixtures.
        files: ["oxlint-plugin-gradcode/**"],
        rules: { "gradcode/single-writer": "off", "gradcode/no-forever-animation": "off" },
      },
    ],
  },
});
