import { definePlugin } from "@oxlint/plugins";
import noEmDashCopy from "./rules/no-em-dash-copy.ts";
import noForeverAnimation from "./rules/no-forever-animation.ts";
import singleWriter from "./rules/single-writer.ts";

// gradcode's golden rules as lint rules. Each message states the fix, so it lands in the
// agent's context. Wired up in the root vite.config.ts (`lint.jsPlugins`).
export default definePlugin({
  meta: { name: "gradcode" },
  rules: {
    "no-em-dash-copy": noEmDashCopy,
    "no-forever-animation": noForeverAnimation,
    "single-writer": singleWriter,
  },
});
