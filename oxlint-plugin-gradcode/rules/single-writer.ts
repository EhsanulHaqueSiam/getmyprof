import { defineRule } from "@oxlint/plugins";

const WRITES = new Set([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "copyFile",
  "copyFileSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "unlink",
  "unlinkSync",
]);
const GRADHUNT_DATA = /professors\.json|excluded\.json|drafts\//;

// ponytail: matches paths written inline in the call. A path built elsewhere slips past;
// trace the variable if that ever happens.
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "gradhunt data has one writer, scout.py. Disallow writing its files directly.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && callee.property.type === "Identifier"
              ? callee.property.name
              : null;
        if (name === null || !WRITES.has(name)) return;
        if (!GRADHUNT_DATA.test(context.sourceCode.getText(node))) return;
        context.report({
          node,
          message:
            "gradhunt data has one writer: scout.py. Shell out to `scout.py add|set|exclude` instead (docs/internals/gradhunt.md).",
        });
      },
    };
  },
});
