import { defineConfig } from "vitest/config";

export default defineConfig({
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
