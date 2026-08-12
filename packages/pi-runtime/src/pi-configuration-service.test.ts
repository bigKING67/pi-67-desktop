import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PiConfigurationReloadState, PiProviderConfigurationChanged } from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiAuthCredentialStore } from "./pi-auth-credential-store.js";
import { PiConfigurationService } from "./pi-configuration-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiConfigurationService", () => {
  it("projects built-in models and persists Provider, credential, and default mutations to Pi files", async () => {
    const fixture = await createFixture();
    try {
      const initial = await fixture.service.get(fixture.cwd);
      const builtin = initial.providers.find((provider) => (
        provider.origin === "builtin" && provider.models.length > 0
      ));
      expect(builtin).toBeDefined();
      expect(initial.providers.flatMap((provider) => provider.models).length).toBeGreaterThan(0);

      const saved = await fixture.service.saveProvider(fixture.cwd, initial.revision, {
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
      const credentialSnapshot = await fixture.service.storeCredential(
        fixture.cwd,
        saved.revision,
        "pi67-test",
        credentialValue
      );
      expect(credentialSnapshot.credentials).toContainEqual({ provider: "pi67-test", type: "api_key" });
      expect(JSON.stringify(credentialSnapshot)).not.toContain(credentialValue);
      expect(await readFile(fixture.service.authPath, "utf8")).toContain(credentialValue);

      const defaultSnapshot = await fixture.service.setDefaultModel(
        fixture.cwd,
        credentialSnapshot.revision,
        "global",
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
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("projects a credential mutation from the revision-pinned bundle without reloading auth.json", async () => {
    const fixture = await createFixture();
    const reload = vi.spyOn(PiAuthCredentialStore.prototype, "reload")
      .mockResolvedValue("redundant auth.json reload");
    try {
      const initial = await fixture.service.get(fixture.cwd);
      const saved = await fixture.service.saveProvider(
        fixture.cwd,
        initial.revision,
        providerInput()
      );

      const credentialSnapshot = await fixture.service.storeCredential(
        fixture.cwd,
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
      const initial = await fixture.service.get(fixture.cwd);
      const saved = await fixture.service.saveProvider(fixture.cwd, initial.revision, providerInput());
      await writeFile(fixture.service.modelsPath, "{ invalid external JSONC\n", "utf8");

      const invalid = await fixture.service.reload(fixture.cwd);
      expect(invalid.syncState).toBe("invalid");
      expect(invalid.providers).toEqual(saved.providers);
      expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ file: "models" }));
      await expect(fixture.service.saveProvider(
        fixture.cwd,
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
        requestConfigurationReload: () => runtimeReload.promise
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

      createRuntime.mockRestore();
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

async function createFixture(options: {
  fallbackPollMs?: number;
  watchDebounceMs?: number;
  runtimeReloadWaitMs?: number;
  fileAccessWaitMs?: number;
  validationRuntimeWaitMs?: number;
  settingsReloadWaitMs?: number;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi67-configuration-service-"));
  temporaryDirectories.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
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
    }
  };
}

function providerInput(name = "Pi 67 Test") {
  return {
    id: "pi67-test",
    name,
    baseUrl: "https://example.invalid/v1",
    api: "openai-responses",
    models: [{ id: "fixture-model", input: ["text" as const], reasoning: false }]
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error("Timed out waiting for configuration change.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
