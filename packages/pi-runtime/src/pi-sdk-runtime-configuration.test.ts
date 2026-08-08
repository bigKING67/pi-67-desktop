import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiProviderConfigurationChanged } from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiConfigurationService } from "./pi-configuration-service.js";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import { createPiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";
import type { RuntimeInitializationObservation } from "./agent-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiSdkRuntime configuration reload", () => {
  it("returns a structured failure when Task model runtime startup stalls and retries cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-runtime-configuration-budget-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);
    const configurationService = new PiConfigurationService(agentDir, {
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000,
      validationRuntimeWaitMs: 250
    });
    const workspaceServices = createPiWorkspaceRuntimeServices({
      cwd,
      agentDir,
      projectTrusted: true,
      configurationService
    });
    const runtime = new PiSdkRuntime({ workspaceServices });
    const stalled = new Promise<ModelRuntime>(() => undefined);
    const createRuntime = vi.spyOn(ModelRuntime, "create").mockReturnValue(stalled);
    const observations: RuntimeInitializationObservation[] = [];
    try {
      const failure = await Promise.race([
        runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" }, (observation) => {
          observations.push(observation);
        })
          .catch((error: unknown) => error),
        delay(500).then(() => "acknowledgement-timeout" as const)
      ]);

      expect(failure).not.toBe("acknowledgement-timeout");
      expect(failure).toMatchObject({
        code: "RUNTIME_NOT_READY",
        recoverable: true,
        details: { stage: "session-model-runtime", waitMs: 250 }
      });
      expect(observations).toEqual(expect.arrayContaining([
        { stage: "load-model-runtime", outcome: "started", durationMs: 0 },
        expect.objectContaining({ stage: "load-model-runtime", outcome: "failed" })
      ]));

      createRuntime.mockRestore();
      await expect(runtime.initialize({
        cwd,
        agentDir,
        trust: "trusted",
        approvalMode: "guided"
      })).resolves.toMatchObject({ sessionId: expect.any(String) });
    } finally {
      createRuntime.mockRestore();
      await runtime.dispose();
      await workspaceServices.dispose();
      await configurationService.dispose();
    }
  }, 20_000);

  it("hot-reloads model metadata and requires reselection after the active model is removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-runtime-configuration-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);
    await writeModels(agentDir, customModels("Original Fixture Model", 16_384));
    await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
      defaultProvider: "pi67-test",
      defaultModel: "fixture-model"
    }, null, 2)}\n`, "utf8");

    const configurationService = new PiConfigurationService(agentDir);
    const workspaceServices = createPiWorkspaceRuntimeServices({
      cwd,
      agentDir,
      projectTrusted: true,
      configurationService
    });
    const runtime = new PiSdkRuntime({ workspaceServices });
    const events: unknown[] = [];
    const configurationChanges: PiProviderConfigurationChanged[] = [];
    runtime.subscribe((event) => {
      if (event.type === "model.catalog.changed") events.push(event);
    });
    configurationService.subscribe(cwd, (change) => configurationChanges.push(change));
    try {
      await configurationService.get(cwd);
      const initial = await runtime.initialize({
        cwd,
        agentDir,
        trust: "trusted",
        approvalMode: "guided"
      });
      expect(initial.selectedModel).toEqual({ provider: "pi67-test", id: "fixture-model" });
      expect(initial.models).toContainEqual(expect.objectContaining({
        provider: "pi67-test",
        id: "fixture-model",
        label: "Original Fixture Model",
        contextWindow: 16_384
      }));
      events.length = 0;
      configurationChanges.length = 0;

      await writeModels(agentDir, customModels("Reloaded Fixture Model", 32_768));
      const session = activeSession(runtime);
      setSessionRunActive(session, true);
      const reloaded = await configurationService.reload(cwd);
      expect(reloaded.syncState).toBe("current");
      expect(configurationChanges.at(-1)?.taskReload).toBe("pending");
      expect(runtime.getSnapshot().models).toContainEqual(expect.objectContaining({
        provider: "pi67-test",
        id: "fixture-model",
        label: "Original Fixture Model",
        contextWindow: 16_384
      }));
      expect(events).toHaveLength(0);

      setSessionRunActive(session, false);
      await runtime.selectModel("pi67-test", "fixture-model");
      const refreshed = runtime.getSnapshot();
      expect(refreshed.selectedModel).toEqual({ provider: "pi67-test", id: "fixture-model" });
      expect(refreshed.models).toContainEqual(expect.objectContaining({
        provider: "pi67-test",
        id: "fixture-model",
        label: "Reloaded Fixture Model",
        contextWindow: 32_768
      }));
      expect(events).toHaveLength(1);

      await writeModels(agentDir, { providers: {} });
      await configurationService.reload(cwd);
      const invalidated = runtime.getSnapshot();
      expect(invalidated.selectedModel).toBeUndefined();
      expect(invalidated.models.some((model) => (
        model.provider === "pi67-test" && model.id === "fixture-model"
      ))).toBe(false);
      expect(events).toHaveLength(2);
      expect(JSON.stringify(events)).not.toContain("fixture-models-json-key");

      await expect(runtime.submitPrompt("This must stop before any Provider request."))
        .rejects.toMatchObject({
          code: "MODEL_NOT_FOUND",
          recoverable: false,
          details: {
            provider: "pi67-test",
            modelId: "fixture-model",
            selectionRequired: true
          }
        });

      const replacement = invalidated.models[0];
      if (!replacement) throw new Error("The Pi runtime fixture requires a built-in replacement model.");
      await runtime.setRuntimeApiKey(replacement.provider, "fixture-runtime-replacement-key");
      const selected = await runtime.selectModel(replacement.provider, replacement.id);
      expect(Object.keys(selected).sort()).toEqual(["controls", "modelCatalog", "sessionId"]);
      expect(selected.controls.selectedModel).toEqual({
        provider: replacement.provider,
        id: replacement.id
      });
      expect(selected.modelCatalog.availableThinkingLevels)
        .toEqual(runtime.getSnapshot().availableThinkingLevels);
      expect(runtime.getSnapshot().selectedModel).toEqual({
        provider: replacement.provider,
        id: replacement.id
      });
    } finally {
      await runtime.dispose();
      await workspaceServices.dispose();
      await configurationService.dispose();
    }
  }, 20_000);
});

function customModels(name: string, contextWindow: number) {
  return {
    providers: {
      "pi67-test": {
        name: "Pi 67 Test",
        baseUrl: "https://example.invalid/v1",
        api: "openai-responses",
        apiKey: "fixture-models-json-key",
        models: [{
          id: "fixture-model",
          name,
          input: ["text"],
          reasoning: false,
          contextWindow,
          maxTokens: 4_096
        }]
      }
    }
  };
}

function writeModels(agentDir: string, models: object): Promise<void> {
  return writeFile(join(agentDir, "models.json"), `${JSON.stringify(models, null, 2)}\n`, "utf8");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function activeSession(runtime: PiSdkRuntime): AgentSession {
  return (runtime as unknown as {
    sessionBindings: { requireSession(): AgentSession };
  }).sessionBindings.requireSession();
}

function setSessionRunActive(session: AgentSession, active: boolean): void {
  (session as unknown as { _isAgentRunActive: boolean })._isAgentRunActive = active;
}
