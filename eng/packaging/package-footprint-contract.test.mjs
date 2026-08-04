import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("packaged runtime footprint contract", () => {
  it("excludes non-runtime metadata and duplicate application workspaces", async () => {
    const config = await readFile(resolve(repositoryRoot, "electron-builder.yml"), "utf8");

    for (const requiredPattern of [
      "!node_modules/**/*.map",
      "!node_modules/**/*.d.ts",
      "!node_modules/**/*.d.mts",
      "!node_modules/**/*.d.cts",
      "!node_modules/@pi67/{agent-host,desktop,renderer}/**",
      "!node_modules/tesseract.js-core/*.wasm.js",
      "!node_modules/@tesseract.js-data/{eng,chi_sim}/4.0.0_best_int/**",
      "!node_modules/officeparser/dist/officeparser.browser*.{js,mjs}"
    ]) expect(config, requiredPattern).toContain(requiredPattern);
  });
});
