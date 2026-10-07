import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import * as NodeURL from "node:url";
import { defineConfig } from "vite-plus";

const SERVER = `127.0.0.1:${process.env.SERVER_PORT ?? 4311}`;

// Web on :5174. Dev is single-origin: /api and /ws proxy to the Node server, so nothing
// bakes a server URL into the bundle. allowedHosts lets `dev-local.sh share` reach it.
export default defineConfig({
  plugins: [
    tanstackRouter({ autoCodeSplitting: true }),
    react(),
    // Explicit parser options: plugin-react v6 only infers them for paths under the cwd.
    babel({ parserOpts: { plugins: ["typescript", "jsx"] }, presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: { "~": NodeURL.fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Routes are split into lazy chunks; scanning every source file up front pre-bundles their
  // deps at startup, so opening a route never re-optimizes deps and reloads the page mid-session.
  optimizeDeps: { entries: ["src/**/*.tsx"] },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5174),
    strictPort: true,
    allowedHosts: [".ts.net"],
    proxy: {
      // Object form keeps the browser's Host, so the server can match it against Origin.
      "/api": { target: `http://${SERVER}` },
      "/ws": { target: `ws://${SERVER}`, ws: true },
    },
  },
});
