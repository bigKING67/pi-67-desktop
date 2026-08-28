import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PiConfigurationReloadState, PiProviderConfigurationChanged } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { installFirstPartyModelProviders } from "./first-party-model-providers.js";
import { PiAuthCredentialStore } from "./pi-auth-credential-store.js";
import {
  configurationDelay as delay,
  createPiConfigurationFixture as createFixture,
  deferredConfigurationValue as deferred,
  piConfigurationProviderInput as providerInput,
  waitForConfiguration as waitFor
} from "./pi-configuration-service-test-fixture.js";

describe("PiConfigurationService", () => {
  it("projects built-in models and persists Provider, credential, and default mutations to Pi files", async () => {
    const fixture = await createFixture();
    try {
      const initial = await fixture.service.getGlobal();
      const builtin = initial.providers.find((provider) => (
        provider.origin === "builtin" && provider.models.length > 0
      ));
      const imageModel = initial.providers.flatMap((provider) => (
        provider.models
          .filter((model) => model.input.includes("image"))
          .map((model) => ({ provider: provider.id, model: model.id }))
      ))[0];
      expect(builtin).toBeDefined();
      expect(imageModel).toBeDefined();
      expect(initial.providers.flatMap((provider) => provider.models).length).toBeGreaterThan(0);

      const saved = await fixture.service.saveGlobalProvider(initial.revision, {
        id: "pi67-test",
        name: "Pi 67 Test",
        baseUrl: "https://example.invalid/v1",
        api: "openai-responses",
        models: [{
          id: "fixture-model",
          name: "Fixture Model",
          input: ["text"],
          reasoning: false,
          contextWindow: 16_384,
          maxTokens: 4_096
        }]
      });
      expect(saved.providers).toContainEqual(expect.objectContaining({
        id: "pi67-test",
        origin: "models.json",
        models: [expect.objectContaining({ id: "fixture-model" })]
      }));
      expect(JSON.parse(await readFile(fixture.service.modelsPath, "utf8"))).toMatchObject({
        providers: {
          "pi67-test": {
            baseUrl: "https://example.invalid/v1",
            api: "openai-responses",
            models: [{ id: "fixture-model" }]
          }
        }
      });

      const credentialValue = "fixture-persistent-credential";
      const credentialSnapshot = await fixture.service.storeGlobalCredential(
        saved.revision,
        "pi67-test",
        credentialValue
      );
      expect(credentialSnapshot.credentials).toContainEqual({ provider: "pi67-test", type: "api_key" });
      expect(JSON.stringify(credentialSnapshot)).not.toContain(credentialValue);
      expect(await readFile(fixture.service.authPath, "utf8")).toContain(credentialValue);

      const defaultSnapshot = await fixture.service.setGlobalDefaultModel(
        credentialSnapshot.revision,
        { provider: builtin!.id, model: builtin!.models[0]!.id }
      );
      expect(defaultSnapshot.defaults.global).toEqual({
        provider: builtin!.id,
        model: builtin!.models[0]!.id
      });
      expect(Buffer.byteLength(JSON.stringify(defaultSnapshot), "utf8")).toBeLessThan(2 * 1024 * 1024);
      expect(JSON.parse(await readFile(fixture.service.globalSettingsPath, "utf8"))).toMatchObject({
        defaultProvider: builtin!.id,
        defaultModel: builtin!.models[0]!.id
      });

      const globalSnapshot = await fixture.service.getGlobal();
      const visionSnapshot = await fixture.service.setGlobalVisionAssistant(
        globalSnapshot.revision,
        imageModel
      );
      expect(visionSnapshot.vision).toMatchObject({
        global: imageModel,
        effective: imageModel,
        disabledByProject: false
      });
      const projectSnapshot = await fixture.service.get(fixture.cwd);
      const disabled = await fixture.service.setProjectVisionAssistant(
        fixture.cwd,
        projectSnapshot.revision,
        { mode: "disabled" }
      );
      expect(disabled.vision).toMatchObject({
        global: imageModel,
        project: { mode: "disabled" },
        disabledByProject: true
      });
      expect(disabled.vision.effective).toBeUndefined();
      const inherited = await fixture.service.setProjectVisionAssistant(
        fixture.cwd,
        disabled.revision,
        undefined
      );
      expect(inherited.vision).toMatchObject({
        global: imageModel,
        effective: imageModel,
        disabledByProject: false
      });
      expect(inherited.vision.project).toBeUndefined();

      const beforeRemoval = await fixture.service.getGlobal();
      const removed = await fixture.service.removeGlobalProvider(
        beforeRemoval.revision,
        "pi67-test"
      );
      expect(removed.providers.some((provider) => provider.id === "pi67-test")).toBe(false);
      const modelsAfterRemoval = JSON.parse(await readFile(fixture.service.modelsPath, "utf8"));
      expect(modelsAfterRemoval.providers?.["pi67-test"]).toBeUndefined();
      expect(await readFile(fixture.service.authPath, "utf8")).toContain(credentialValue);
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("reuses the current validated runtime when only default settings change", async () => {
    const fixture = await createFixture();
    try {
      const initial = await fixture.service.getGlobal();
      const saved = await fixture.service.saveGlobalProvider(
        initial.revision,
        providerInput()
      );
      const createRuntime = vi.spyOn(ModelRuntime, "create")
        .mockRejectedValue(new Error("settings-only mutation must not create another runtime"));
      try {
        const updated = await fixture.service.setGlobalDefaultModel(
          saved.revision,
          { provider: "pi67-test", model: "fixture-model" }
        );

        expect(updated.defaults.global).toEqual({ provider: "pi67-test", model: "fixture-model" });
        expect(updated.syncState).toBe("current");
        expect(createRuntime).not.toHaveBeenCalled();
      } finally {
        createRuntime.mockRestore();
      }
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("projects a credential mutation from the revision-pinned bundle without reloading auth.json", async () => {
    const fixture = await createFixture();
    const reload = vi.spyOn(PiAuthCredentialStore.prototype, "reload")
      .mockResolvedValue("redundant auth.json reload");
    try {
      const initial = await fixture.service.getGlobal();
      const saved = await fixture.service.saveGlobalProvider(
        initial.revision,
        providerInput()
      );

      const credentialSnapshot = await fixture.service.storeGlobalCredential(
        saved.revision,
        "pi67-test",
        "revision-pinned-credential"
      );

      expect(credentialSnapshot).toMatchObject({ syncState: "current" });
      expect(credentialSnapshot.credentials).toContainEqual({
        provider: "pi67-test",
        type: "api_key"
      });
      expect(reload).not.toHaveBeenCalled();
      expect(JSON.stringify(credentialSnapshot)).not.toContain("revision-pinned-credential");
    } finally {
      reload.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);

  it("keeps the last-known-good projection for invalid external JSON and rejects stale writes", async () => {
    const fixture = await createFixture();
    try {
      const initial = await fixture.service.getGlobal();
      const saved = await fixture.service.saveGlobalProvider(initial.revision, providerInput());
      await writeFile(fixture.service.modelsPath, "{ invalid external JSONC\n", "utf8");

      const invalid = await fixture.service.reloadGlobal();
      expect(invalid.syncState).toBe("invalid");
      expect(invalid.providers).toEqual(saved.providers);
      expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ file: "models" }));
      await expect(fixture.service.saveGlobalProvider(
        saved.revision,
        providerInput("Changed")
      )).rejects.toMatchObject({ code: "CONFIGURATION_CHANGED_EXTERNALLY" });
      expect(await readFile(fixture.service.modelsPath, "utf8")).toBe("{ invalid external JSONC\n");
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("discovers a project settings directory created after registration", async () => {
    const fixture = await createFixture({ fallbackPollMs: 15, watchDebounceMs: 2 });
    try {
      const initial = await fixture.service.get(fixture.cwd);
      const model = initial.providers.flatMap((provider) => (
        provider.models.map((item) => ({ provider: provider.id, model: item.id }))
      ))[0];
      if (!model) throw new Error("The Pi runtime fixture requires at least one built-in model.");
      const changes: PiProviderConfigurationChanged[] = [];
      fixture.service.subscribe(fixture.cwd, (change) => changes.push(change));

      const projectDirectory = join(fixture.cwd, ".pi");
      await mkdir(projectDirectory);
      await writeFile(join(projectDirectory, "settings.json"), `${JSON.stringify({
        defaultProvider: model.provider,
        defaultModel: model.model
      }, null, 2)}\n`, "utf8");

      await waitFor(() => changes.some((change) => (
        change.source === "external"
        && change.changedFiles.includes("project-settings")
        && change.snapshot.defaults.project?.provider === model.provider
        && change.snapshot.defaults.project?.model === model.model
      )));
      const current = await fixture.service.get(fixture.cwd);
      expect(current.defaults.project).toEqual(model);
      expect(current.defaults.effective).toEqual(model);
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("returns Provider configuration while a Task model reload remains pending", async () => {
    const fixture = await createFixture({
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000,
      runtimeReloadWaitMs: 5
    });
    const runtimeReload = deferred<PiConfigurationReloadState>();
    let unregisterRuntime: (() => void) | undefined;
    try {
      await fixture.service.get(fixture.cwd);
      const changes: PiProviderConfigurationChanged[] = [];
      fixture.service.subscribe(fixture.cwd, (change) => changes.push(change));
      unregisterRuntime = fixture.service.registerRuntime(fixture.cwd, {
        requestConfigurationReload: () => runtimeReload.promise,
        requestModelCatalogReload: async () => "applied"
      });
      await writeFile(fixture.service.modelsPath, `${JSON.stringify({ providers: {} }, null, 2)}\n`, "utf8");

      const result = await Promise.race([
        fixture.service.reload(fixture.cwd),
        delay(1_000).then(() => "timed-out" as const)
      ]);

      expect(result).not.toBe("timed-out");
      expect(result).toMatchObject({ syncState: "current" });
      expect(changes.at(-1)?.taskReload).toBe("pending");
    } finally {
      runtimeReload.resolve("applied");
      unregisterRuntime?.();
      await fixture.dispose();
    }
  }, 20_000);

  it("keeps the Provider registration refresh inside the offline validation budget", async () => {
    const fixture = await createFixture({
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000,
      validationRuntimeWaitMs: 10
    });
    const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
    const releaseRefresh = deferred<Awaited<ReturnType<ModelRuntime["refresh"]>>>();
    const createRuntime = vi.spyOn(ModelRuntime, "create").mockResolvedValue(runtime);
    const refresh = vi.spyOn(runtime, "refresh").mockReturnValue(releaseRefresh.promise);
    try {
      const result = await Promise.race([
        fixture.service.get(fixture.cwd),
        delay(1_000).then(() => "timed-out" as const)
      ]);

      expect(result).not.toBe("timed-out");
      expect(result).toMatchObject({
        syncState: "invalid",
        diagnostics: [{
          file: "models",
          message: expect.stringContaining("bounded startup budget")
        }]
      });
      expect(createRuntime).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledWith({ allowNetwork: false });
    } finally {
      releaseRefresh.resolve({ errors: new Map(), aborted: false });
      createRuntime.mockRestore();
      refresh.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);

  it("returns an invalid snapshot before a stalled offline Provider validation can exhaust IPC", async () => {
    const fixture = await createFixture({
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000,
      validationRuntimeWaitMs: 10
    });
    const recoveredRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
    await installFirstPartyModelProviders(recoveredRuntime);
    const stalled = new Promise<ModelRuntime>(() => undefined);
    const createRuntime = vi.spyOn(ModelRuntime, "create").mockReturnValue(stalled);
    try {
      const result = await Promise.race([
        fixture.service.get(fixture.cwd),
        delay(500).then(() => "acknowledgement-timeout" as const)
      ]);

      expect(result).not.toBe("acknowledgement-timeout");
      expect(result).toMatchObject({
        syncState: "invalid",
        providers: [],
        credentials: [],
        diagnostics: [expect.objectContaining({
          file: "models",
          message: expect.stringContaining("bounded startup budget")
        })]
      });
      expect((result as Exclude<typeof result, string>).files).toHaveLength(4);

      createRuntime.mockResolvedValue(recoveredRuntime);
      await expect(fixture.service.reload(fixture.cwd)).resolves.toMatchObject({ syncState: "current" });
    } finally {
      createRuntime.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);

  it("fails Task model runtime creation within the Host budget and can recover on retry", async () => {
    const fixture = await createFixture({
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000,
      validationRuntimeWaitMs: 250
    });
    const stalled = new Promise<ModelRuntime>(() => undefined);
    const createRuntime = vi.spyOn(ModelRuntime, "create").mockReturnValue(stalled);
    try {
      const failure = await Promise.race([
        fixture.service.createModelRuntime().catch((error: unknown) => error),
        delay(500).then(() => "acknowledgement-timeout" as const)
      ]);

      expect(failure).not.toBe("acknowledgement-timeout");
      expect(failure).toMatchObject({
        code: "RUNTIME_NOT_READY",
        recoverable: true,
        details: { stage: "session-model-runtime", waitMs: 250 }
      });

      createRuntime.mockRestore();
      await expect(fixture.service.createModelRuntime()).resolves.toBeInstanceOf(ModelRuntime);
    } finally {
      createRuntime.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);

  it("does not let an unrelated Workspace settings reload delay the requested configuration", async () => {
    const fixture = await createFixture({
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000,
      settingsReloadWaitMs: 10
    });
    const otherCwd = join(fixture.root, "other-workspace");
    await mkdir(otherCwd);
    const otherSettings = SettingsManager.create(otherCwd, fixture.service.agentDir, { projectTrusted: true });
    const otherReload = vi.spyOn(otherSettings, "reload").mockReturnValue(new Promise(() => undefined));
    const unregisterOther = fixture.service.registerWorkspace({
      cwd: otherCwd,
      settingsManager: otherSettings,
      projectTrusted: true
    });
    try {
      const result = await Promise.race([
        fixture.service.get(fixture.cwd),
        delay(500).then(() => "acknowledgement-timeout" as const)
      ]);

      expect(result).not.toBe("acknowledgement-timeout");
      expect(result).toMatchObject({ syncState: "current" });
      expect(otherReload).not.toHaveBeenCalled();
    } finally {
      unregisterOther();
      otherReload.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);

  it("returns an invalid snapshot when the requested Workspace settings reload stalls", async () => {
    const fixture = await createFixture({
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000,
      settingsReloadWaitMs: 10
    });
    const reload = vi.spyOn(fixture.settingsManager, "reload").mockReturnValue(new Promise(() => undefined));
    try {
      const result = await Promise.race([
        fixture.service.get(fixture.cwd),
        delay(500).then(() => "acknowledgement-timeout" as const)
      ]);

      expect(result).not.toBe("acknowledgement-timeout");
      expect(result).toMatchObject({
        syncState: "invalid",
        diagnostics: [expect.objectContaining({
          file: "global-settings",
          message: expect.stringContaining("bounded startup budget")
        })]
      });
      reload.mockRestore();
      await expect(fixture.service.reload(fixture.cwd)).resolves.toMatchObject({ syncState: "current" });
    } finally {
      reload.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);
});
