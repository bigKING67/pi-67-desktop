import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { PiConfigurationService } from "./pi-configuration-service.js";

export async function createPiConfigurationFixture(options: {
  fallbackPollMs?: number;
  watchDebounceMs?: number;
  runtimeReloadWaitMs?: number;
  fileAccessWaitMs?: number;
  validationRuntimeWaitMs?: number;
  settingsReloadWaitMs?: number;
  initialAuthContent?: string;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi67-configuration-service-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  if (options.initialAuthContent !== undefined) {
    await writeFile(join(agentDir, "auth.json"), options.initialAuthContent, "utf8");
  }
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const service = new PiConfigurationService(agentDir, options);
  const unregister = service.registerWorkspace({ cwd, settingsManager, projectTrusted: true });
  return {
    root,
    cwd,
    settingsManager,
    service,
    async dispose() {
      unregister();
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  };
}

export function piConfigurationProviderInput(name = "Pi 67 Test") {
  return {
    id: "pi67-test",
    name,
    baseUrl: "https://example.invalid/v1",
    api: "openai-responses",
    models: [{ id: "fixture-model", input: ["text" as const], reasoning: false }]
  };
}

export async function waitForConfiguration(
  predicate: () => boolean,
  timeoutMs = 4_000
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for configuration change.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function deferredConfigurationValue<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export function configurationDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
