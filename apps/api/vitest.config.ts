import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 60000,
  },
  resolve: {
    alias: {
      "@exceledge/accounting-domain": path.resolve(
        __dirname,
        "../../packages/domain/src/index.ts",
      ),
    },
  },
});
