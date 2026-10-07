import { defineRule } from "@oxlint/plugins";

const FOREVER_CLASS = /\banimate-(spin|pulse|ping|bounce)\b/;
const ANIMATION_KEY = /^animation(IterationCount)?$/;
const MESSAGE =
  "Animations that never stop repaint every frame and peg the GPU on high-refresh displays. Use a one-shot transition or a static label (docs/internals/design.md, Motion).";

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow continuously repainting animations: Tailwind's looping classes and infinite keyframes.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string" && FOREVER_CLASS.test(node.value))
          context.report({ node, message: MESSAGE });
      },
      TemplateElement(node) {
        if (FOREVER_CLASS.test(node.value.raw)) context.report({ node, message: MESSAGE });
      },
      Property(node) {
        const key =
          node.key.type === "Identifier"
            ? node.key.name
            : node.key.type === "Literal"
              ? String(node.key.value)
              : "";
        if (!ANIMATION_KEY.test(key) || node.value.type !== "Literal") return;
        if (String(node.value.value).includes("infinite"))
          context.report({ node, message: MESSAGE });
      },
    };
  },
});
