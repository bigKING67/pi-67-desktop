import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runBundledOpenVikingNativeProbe } from "./run-openviking-native-probe.mjs";

describe("bundled OpenViking native probe runner", () => {
  it("builds the source graph, runs the generated entry, and removes it", async () => {
    const calls = [];
    let output;
    const execute = vi.fn(async (command, args, options) => {
      calls.push({ args, command, options });
      if (command === "corepack") {
        output = args.at(-1);
        await writeFile(join(output, "probe-openviking-native.mjs"), "// generated");
      }
    });

    await runBundledOpenVikingNativeProbe("/absolute/python3.12", { execute });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ command: "corepack", args: expect.arrayContaining(["tsdown", "--out-dir"]) });
    expect(calls[1]).toMatchObject({ command: process.execPath, args: [expect.stringContaining("probe-openviking-native.mjs"), "/absolute/python3.12"] });
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans the temporary output when bundling fails and rejects relative Python paths", async () => {
    let output;
    const execute = vi.fn(async (_command, args) => {
      output = args.at(-1);
      throw new Error("synthetic build failure");
    });
    await expect(runBundledOpenVikingNativeProbe("/absolute/python3.12", { execute })).rejects.toThrow("synthetic");
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(runBundledOpenVikingNativeProbe("relative/python", { execute })).rejects.toThrow("absolute");
  });
});
