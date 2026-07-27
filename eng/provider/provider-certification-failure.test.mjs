import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })));
});

describe("Provider certification failure boundary", () => {
  it("writes a bounded receipt and exposes only a fixed stderr sentinel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-provider-failure-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "summary.json");
    const scriptPath = join(directory, "runner.mjs");
    const contractUrl = new URL("./real-provider-long-turn-contract.mjs", import.meta.url).href;
    const writerUrl = new URL("./provider-certification-failure.mjs", import.meta.url).href;
    await writeFile(scriptPath, `
      import {
        createRealProviderLongTurnFailureSummary
      } from ${JSON.stringify(contractUrl)};
      import { writeProviderCertificationFailureAndThrow } from ${JSON.stringify(writerUrl)};
      const secret = process.env.TEST_PROVIDER_SECRET;
      const rawProviderError = new Error(secret + " raw provider body\\nsecond line");
      if (!rawProviderError.message.includes(secret)) throw new Error("Invalid failure fixture.");
      const summary = createRealProviderLongTurnFailureSummary({
        appVersion: "0.1.0",
        platform: "win32",
        architecture: "x64",
        executableSha256: "a".repeat(64),
        providerId: "provider",
        modelId: "model",
        requestedThinkingLevel: "off",
        failureStage: "run-provider-turn",
        evidence: { artifactResolved: true }
      });
      await writeProviderCertificationFailureAndThrow(process.env.TEST_OUTPUT_PATH, summary);
    `, "utf8");

    const secret = "short-secret-body";
    let stderr = "";
    try {
      await execFileAsync(process.execPath, [scriptPath], {
        env: { ...process.env, TEST_OUTPUT_PATH: outputPath, TEST_PROVIDER_SECRET: secret }
      });
    } catch (error) {
      stderr = String(error.stderr ?? "");
    }
    const receipt = await readFile(outputPath, "utf8");

    expect(stderr).toContain("inspect the bounded receipt artifact");
    expect(stderr).not.toContain(secret);
    expect(stderr).not.toContain("raw provider body");
    expect(receipt).not.toContain(secret);
    expect(receipt).not.toContain("raw provider body");
  });
});
