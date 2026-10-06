import { defineRule } from "@oxlint/plugins";

const EM_DASH = "—";
const MESSAGE =
  "No em dashes in UI copy. Use a comma, colon or period (docs/internals/design.md, Copy).";

// Enabled for apps/web/src only (root vite.config.ts): server logs and tests may use any text.
export default defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow em dashes in user-facing text." },
  },
  create(context) {
    return {
      JSXText(node) {
        if (node.value.includes(EM_DASH)) context.report({ node, message: MESSAGE });
      },
      Literal(node) {
        if (typeof node.value === "string" && node.value.includes(EM_DASH))
          context.report({ node, message: MESSAGE });
      },
    };
  },
});
