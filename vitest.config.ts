import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@pi67/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
      "@pi67/extension-compat": fileURLToPath(new URL("./packages/extension-compat/src/index.ts", import.meta.url)),
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
      include: [
        "packages/*/src/**/*.ts",
        "apps/agent-host/src/**/*.ts",
        "apps/desktop/src/**/*.ts",
        "apps/renderer/src/**/*.ts"
      ],
      exclude: [
        "**/dist/**",
        "**/*.config.ts",
        "**/*.d.ts",
        "**/*.test.*",
        "tests/**",
        "apps/agent-host/src/index.ts",
        "apps/desktop/src/app-protocol.ts",
        "apps/desktop/src/main-window.ts",
        "apps/desktop/src/main.ts",
        "apps/desktop/src/preload.ts",
        "apps/desktop/src/system-bridge.ts"
      ],
      thresholds: {
        branches: 70,
        "packages/domain/src/**": { branches: 90 },
        "packages/protocol/src/**": { branches: 80 },
        "packages/extension-compat/src/**": { branches: 85 },
        "packages/pi-runtime/src/**": { branches: 75 },
        "apps/agent-host/src/**": { branches: 74 },
        "apps/desktop/src/**": { branches: 80 },
        "apps/renderer/src/**": { branches: 55 }
      }
    }
  }
});
