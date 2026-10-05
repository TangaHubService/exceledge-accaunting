import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.ACCOUNTING_API_PROXY_TARGET || "http://localhost:4600";
  return {
    plugins: [react()],
    build: {
      // @exceledge/accounting-domain is a workspace package: Vite resolves it
      // through the node_modules symlink to its real path
      // (packages/domain/dist/index.js, CommonJS). Vite 6 only runs the
      // CommonJS transform on files matching `include: [/node_modules/]` by
      // default, so the real-path file would be bundled as-is (empty ESM) and
      // every named import would fail with "X is not exported by ...".
      // Include the workspace dist explicitly.
      commonjsOptions: {
        include: [/node_modules/, /packages\/domain/],
      },
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
