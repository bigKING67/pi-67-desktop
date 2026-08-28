import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolveRendererModulePreloadDependencies } from "./module-preload-policy.js";

export default defineConfig(({ command }) => ({
  base: "/",
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
      "src/transcript/code-highlighter.worker.ts"
    ]
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  worker: {
    format: "es"
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
