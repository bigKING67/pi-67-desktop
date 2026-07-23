import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("react-markdown") || id.includes("remark-gfm")) return "markdown";
          if (id.includes("react-aria-components")) return "accessibility";
          if (id.includes("react-virtuoso")) return "virtualization";
          return undefined;
        }
      }
    }
  }
}));
