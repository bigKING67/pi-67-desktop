import type { ConfigEnv, UserConfigFn } from "vite";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.js";

const serveEnvironment: ConfigEnv = {
  command: "serve",
  mode: "test",
  isSsrBuild: false,
  isPreview: false
};

describe("renderer Vite dependency optimization", () => {
  it("discovers the Shiki worker during the initial dependency scan", async () => {
    expect(typeof viteConfig).toBe("function");

    const config = await (viteConfig as UserConfigFn)(serveEnvironment);

    expect(config.optimizeDeps?.entries).toEqual([
      "index.html",
      "src/transcript/code-highlighter.worker.ts"
    ]);
  });
});
