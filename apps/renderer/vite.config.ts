import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolveRendererModulePreloadDependencies } from "./module-preload-policy.js";

const workerEntityDecoder = `${import.meta.dirname.replaceAll("\\", "/")}/node_modules/decode-named-character-reference/index.js`;

export default defineConfig(({ command }) => ({
  base: "/",
  // Development serves worker imports through the client resolver.
  ...(command === "serve" ? { resolve: { alias: { "decode-named-character-reference": workerEntityDecoder } } } : {}),
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    {
      name: "pi67-development-csp",
      transformIndexHtml(html) {
        return command === "serve"
          ? html.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173")
          : html;
      }
    }
  ],
  optimizeDeps: {
    entries: [
      "index.html",
      "src/transcript/code-highlighter.worker.ts",
      "src/transcript/streaming-markdown-parser.worker.ts"
    ]
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  worker: {
    format: "es",
    plugins: () => [{
      name: "pi67-worker-entity-decoder",
      enforce: "pre",
      // The browser export uses document; the default export is DOM-free.
      resolveId(id) {
        return id === "decode-named-character-reference"
          ? this.resolve(workerEntityDecoder, undefined, { skipSelf: true })
          : undefined;
      }
    }]
  },
  build: {
    target: "chrome150",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: {
      resolveDependencies: resolveRendererModulePreloadDependencies
    },
    rolldownOptions: {
      treeshake: {
        moduleSideEffects: (id) => !id.includes("/node_modules/typebox/")
      }
    }
  }
}));
