import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiSdkRuntime } from "../../packages/pi-runtime/src/pi-sdk-runtime.ts";
import {
  CONTROLLED_MODEL_VALUE,
  CONTROLLED_PROMPT_TEXT,
  isProcessAlive,
  readPositiveProcessId,
  waitForProcessExit,
  writeControlledShutdownExtension
} from "./controlled-shutdown-fixture.ts";

const temporaryDirectories = [];
const [provider, modelId] = CONTROLLED_MODEL_VALUE.split("/");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("controlled Provider runtime fixture", () => {
  it("does not select the controlled model until the first Prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-controlled-provider-settings-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    const childPidPath = join(root, "child.pid");
    const settingsPath = join(agentDir, "settings.json");
    const originalSettings = `${JSON.stringify({
      defaultProvider: "openai",
      defaultModel: "gpt-5",
      steeringMode: "one-at-a-time"
    }, null, 2)}\n`;
    await Promise.all([mkdir(cwd), mkdir(extensionsDirectory, { recursive: true })]);
    await Promise.all([
      writeFile(settingsPath, originalSettings, "utf8"),
      writeFile(join(agentDir, "auth.json"), JSON.stringify({
        openai: { type: "api_key", key: "pi67-controlled-provider-settings-fixture" }
      }), "utf8"),
      writeFile(join(agentDir, "models.json"), "{\"providers\":{}}\n", "utf8"),
      writeControlledShutdownExtension({
        extensionPath: join(extensionsDirectory, "controlled-provider.ts"),
        childPidPath,
        lifecyclePath: join(root, "lifecycle.txt")
      })
    ]);

    const runtime = new PiSdkRuntime();
    let childPid;
    try {
      await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
      expect(runtime.getSnapshot().selectedModel).toEqual({ provider: "openai", id: "gpt-5" });
      await expect(readFile(settingsPath, "utf8")).resolves.toBe(originalSettings);

      const prompt = runtime.submitPrompt(CONTROLLED_PROMPT_TEXT);
      childPid = await readPositiveProcessId(childPidPath);
      expect(runtime.getSnapshot().selectedModel).toEqual({ provider, id: modelId });
      await expect(readFile(settingsPath, "utf8")).resolves.toBe(originalSettings);
      await runtime.abort();
      await expect(prompt).resolves.toBeUndefined();
      await expect(waitForProcessExit(childPid)).resolves.toBeUndefined();
    } finally {
      await runtime.dispose();
      if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
    }
  }, 15_000);

  it("runs and aborts a provider-backed prompt without external credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-controlled-provider-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    const childPidPath = join(root, "child.pid");
    await Promise.all([mkdir(cwd), mkdir(extensionsDirectory, { recursive: true })]);
    await writeControlledShutdownExtension({
      extensionPath: join(extensionsDirectory, "controlled-provider.ts"),
      childPidPath,
      lifecyclePath: join(root, "lifecycle.txt")
    });

    const runtime = new PiSdkRuntime();
    let childPid;
    try {
      await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
      expect(runtime.getSnapshot().models).toContainEqual(expect.objectContaining({
        provider,
        id: modelId,
        configured: true
      }));
      expect(runtime.getSnapshot().selectedModel).toEqual({ provider, id: modelId });

      const prompt = runtime.submitPrompt(CONTROLLED_PROMPT_TEXT);
      childPid = await readPositiveProcessId(childPidPath);
      expect(isProcessAlive(childPid)).toBe(true);
      await runtime.abort();
      await expect(prompt).resolves.toBeUndefined();
      await expect(waitForProcessExit(childPid)).resolves.toBeUndefined();
    } finally {
      await runtime.dispose();
      if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
    }
  }, 15_000);
});
