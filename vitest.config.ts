import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@pi67/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
      "@pi67/pi-runtime": fileURLToPath(new URL("./packages/pi-runtime/src/index.ts", import.meta.url)),
      "@pi67/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts", "eng/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      exclude: ["**/dist/**", "**/*.config.ts", "tests/**"]
    }
  }
});
