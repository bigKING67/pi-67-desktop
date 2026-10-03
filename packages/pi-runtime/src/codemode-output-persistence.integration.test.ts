import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { callNativeTool, createNativeMcpFixture } from "./native-mcp.test-support.js";

async function createCodemodeOutputFixture(saveOutput?: boolean) {
  const fixture = await createNativeMcpFixture({
    upstreamDefaults: true,
    additionalExtensions: [{
      name: "pi67-codemode-output-persistence-test",
      factory: createCodemodeExtension({ models: false, ...(saveOutput === undefined ? {} : { saveOutput }) })
    }]
  });
  try {
    fixture.session.setActiveToolsByName([...fixture.session.getActiveToolNames(), "codemode"]);
    return fixture;
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

function resultText(result: unknown): string {
  return JSON.stringify(result) ?? "";
}

async function withFixtureTempDir<T>(root: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = root;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
}

describe("Codemode output persistence host option", () => {
  it("keeps upstream temporary-file persistence when the public option is omitted", async () => {
    const fixture = await createCodemodeOutputFixture();
    let fullOutputPath: string | undefined;
    try {
      const marker = `PI67_CODEMODE_DEFAULT_SPILL:${"x".repeat(5_000)}`;
      const result = await withFixtureTempDir(fixture.root, () => callNativeTool(
        fixture.session,
        "codemode",
        { code: `// @options: {"max_output_tokens": 16}\ntext(${JSON.stringify(marker)});` }
      ));
      fullOutputPath = (result?.details as { fullOutputPath?: string } | undefined)?.fullOutputPath;
      expect(fullOutputPath).toMatch(/pi-codemode-[a-f0-9]+\.txt$/);
      expect(resultText(result)).toContain(`[Full output: ${fullOutputPath}`);
      expect(await readFile(fullOutputPath!, "utf8")).toBe(marker);
    } finally {
      await fixture.close();
    }
    await expect(stat(fullOutputPath!)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);

  it.each([
    ["script error", `// @options: {"max_output_tokens": 16}\ntext("PI67_CODEMODE_ERROR_SPILL:" + "x".repeat(5_000)); throw new Error("synthetic error");`],
    ["script timeout", `// @options: {"max_output_tokens": 16, "timeout_ms": 150}\ntext("PI67_CODEMODE_TIMEOUT_SPILL:" + "x".repeat(5_000)); while (true) {}`]
  ])("does not save truncated %s output when disabled", async (_scenario, code) => {
    const fixture = await createCodemodeOutputFixture(false);
    try {
      const before = await readdir(fixture.root);
      const result = await withFixtureTempDir(fixture.root, () => callNativeTool(
        fixture.session,
        "codemode",
        { code }
      ));
      expect(result?.isError).toBe(true);
      expect(resultText(result)).toContain("Warning: truncated output");
      expect(resultText(result)).toContain("[Full output was not saved by host policy.]");
      expect(result?.details).not.toHaveProperty("fullOutputPath");
      expect(await readdir(fixture.root)).toEqual(before);
    } finally {
      await fixture.close();
    }
  }, 20_000);

  it("does not save truncated nested tool output when disabled", async () => {
    const fixture = await createCodemodeOutputFixture(false);
    try {
      const path = join(fixture.root, "nested-output.txt");
      await writeFile(path, `PI67_CODEMODE_NESTED_SPILL:${"x".repeat(5_000)}`);
      const before = await readdir(fixture.root);
      const result = await withFixtureTempDir(fixture.root, () => callNativeTool(
        fixture.session,
        "codemode",
        { code: `// @options: {"max_output_tokens": 16}\ntext(await tools.read({path: ${JSON.stringify(path)}}));` }
      ));
      expect(result?.isError).toBe(false);
      expect(resultText(result)).toContain("Warning: truncated output");
      expect(resultText(result)).toContain("[Full output was not saved by host policy.]");
      expect(result?.details).not.toHaveProperty("fullOutputPath");
      expect(await readdir(fixture.root)).toEqual(before);
    } finally {
      await fixture.close();
    }
  }, 20_000);
});
