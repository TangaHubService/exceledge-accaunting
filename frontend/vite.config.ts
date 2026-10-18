import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.ACCOUNTING_API_PROXY_TARGET || "http://localhost:4600";
  return {
    plugins: [react()],
    resolve: {
      // Serve domain TypeScript source instead of CommonJS dist. Vite otherwise
      // resolves the file: workspace package to packages/domain/dist/index.js and
      // serves it raw (no named ESM exports → "does not provide an export named …").
      alias: {
        "@exceledge/accounting-domain": path.resolve(root, "packages/domain/src/index.ts"),
      },
    },
    optimizeDeps: {
      exclude: ["@exceledge/accounting-domain"],
    },
    server: {
      port: 5174,
      proxy: {
        "/api": apiTarget,
        "/health": apiTarget,
      },
    },
  };
});
