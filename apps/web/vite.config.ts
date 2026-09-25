import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.ACCOUNTING_API_PROXY_TARGET || "http://localhost:4600";
  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        "/api": apiTarget,
        "/health": apiTarget,
      },
    },
  };
});
