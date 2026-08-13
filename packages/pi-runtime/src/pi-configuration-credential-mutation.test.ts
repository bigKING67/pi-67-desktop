import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiAuthCredentialStore } from "./pi-auth-credential-store.js";
import { PiConfigurationService } from "./pi-configuration-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("PiConfigurationService credential mutations", () => {
  it("reuses the validation runtime when the configuration revisions still match", async () => {
    const fixture = await createFixture();
    try {
      const saved = await registerProvider(fixture);
      const createRuntime = vi.spyOn(ModelRuntime, "create");

      const snapshot = await fixture.service.storeCredential(
        fixture.cwd,
        saved.revision,
        "pi67-test",
        "single-validation-runtime-credential"
      );

      expect(snapshot).toMatchObject({
        syncState: "current",
        credentials: [{ provider: "pi67-test", type: "api_key" }]
      });
      expect(createRuntime).toHaveBeenCalledOnce();
      expect(JSON.stringify(snapshot)).not.toContain("single-validation-runtime-credential");
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("revalidates a changed models revision without installing the stale candidate", async () => {
    const fixture = await createFixture();
    try {
      const saved = await registerProvider(fixture);
      const originalCreate = ModelRuntime.create.bind(ModelRuntime);
      const runtimes: ModelRuntime[] = [];
      let changed = false;
      const createRuntime = vi.spyOn(ModelRuntime, "create").mockImplementation(async (...args) => {
        const runtime = await originalCreate(...args);
        runtimes.push(runtime);
        if (!changed) {
          changed = true;
          const models = await readFile(fixture.service.modelsPath, "utf8");
          await writeFile(fixture.service.modelsPath, `${models.trimEnd()}  \n`, "utf8");
        }
        return runtime;
      });

      const snapshot = await fixture.service.storeCredential(
        fixture.cwd,
        saved.revision,
        "pi67-test",
        "models-revision-credential"
      );

      expect(snapshot).toMatchObject({ syncState: "current" });
      expect(createRuntime).toHaveBeenCalledTimes(2);
      expect(configurationServiceRuntime(fixture.service)).toBe(runtimes[1]);
      expect(configurationServiceRuntime(fixture.service)).not.toBe(runtimes[0]);
      expect(JSON.stringify(snapshot)).not.toContain("models-revision-credential");
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("rolls back credential storage and projection when validation fails", async () => {
    const fixture = await createFixture();
    try {
      const saved = await registerProvider(fixture);
      vi.spyOn(ModelRuntime, "create").mockRejectedValueOnce(
        new Error("credential validation failed")
      );

      await expect(fixture.service.storeCredential(
        fixture.cwd,
        saved.revision,
        "pi67-test",
        "must-be-rolled-back"
      )).rejects.toThrow("credential validation failed");

      await expect(readFile(fixture.service.authPath, "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(configurationCredentialStore(fixture.service).list()).resolves.toEqual([]);
      expect((await fixture.service.get(fixture.cwd)).credentials).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("rejects an externally replaced auth revision without overwriting it", async () => {
    const fixture = await createFixture();
    try {
      const saved = await registerProvider(fixture);
      const externalContent = `${JSON.stringify({
        "external-provider": { type: "api_key", key: "external-credential" }
      }, null, 2)}\n`;
      const originalCreate = ModelRuntime.create.bind(ModelRuntime);
      let changed = false;
      vi.spyOn(ModelRuntime, "create").mockImplementation(async (...args) => {
        const runtime = await originalCreate(...args);
        if (!changed) {
          changed = true;
          await writeFile(fixture.service.authPath, externalContent, "utf8");
        }
        return runtime;
      });

      await expect(fixture.service.storeCredential(
        fixture.cwd,
        saved.revision,
        "pi67-test",
        "desktop-credential"
      )).rejects.toMatchObject({ code: "CONFIGURATION_CHANGED_EXTERNALLY" });

      expect(await readFile(fixture.service.authPath, "utf8")).toBe(externalContent);
      await expect(configurationCredentialStore(fixture.service).list()).resolves.toEqual([{
        providerId: "external-provider",
        type: "api_key"
      }]);
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("reuses one validation runtime when removing a credential", async () => {
    const fixture = await createFixture();
    try {
      const saved = await registerProvider(fixture);
      const stored = await fixture.service.storeCredential(
        fixture.cwd,
        saved.revision,
        "pi67-test",
        "credential-to-remove"
      );
      const createRuntime = vi.spyOn(ModelRuntime, "create");

      const removed = await fixture.service.removeCredential(
        fixture.cwd,
        stored.revision,
        "pi67-test"
      );

      expect(removed).toMatchObject({ syncState: "current", credentials: [] });
      expect(createRuntime).toHaveBeenCalledOnce();
      expect(await readFile(fixture.service.authPath, "utf8"))
        .not.toContain("credential-to-remove");
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it("keeps last-known-good credentials visible when external auth JSON is invalid", async () => {
    const fixture = await createFixture();
    try {
      const saved = await registerProvider(fixture);
      const stored = await fixture.service.storeCredential(
        fixture.cwd,
        saved.revision,
        "pi67-test",
        "last-known-good-credential"
      );
      await writeFile(fixture.service.authPath, "{ invalid external auth JSON\n", "utf8");

      const invalid = await fixture.service.reload(fixture.cwd);

      expect(invalid).toMatchObject({
        syncState: "invalid",
        credentials: stored.credentials,
        diagnostics: [expect.objectContaining({ file: "auth" })]
      });
      expect(JSON.stringify(invalid)).not.toContain("last-known-good-credential");
    } finally {
      await fixture.dispose();
    }
  }, 20_000);
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-credential-mutation-"));
  temporaryDirectories.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const service = new PiConfigurationService(agentDir, {
    fallbackPollMs: 60_000,
    watchDebounceMs: 60_000
  });
  const unregister = service.registerWorkspace({ cwd, settingsManager, projectTrusted: true });
  return {
    cwd,
    service,
    async dispose() {
      unregister();
      await service.dispose();
    }
  };
}

async function registerProvider(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const initial = await fixture.service.get(fixture.cwd);
  return fixture.service.saveProvider(fixture.cwd, initial.revision, {
    id: "pi67-test",
    name: "Pi 67 Test",
    baseUrl: "https://example.invalid/v1",
    api: "openai-responses",
    models: [{ id: "fixture-model", input: ["text"], reasoning: false }]
  });
}

function configurationCredentialStore(service: PiConfigurationService): PiAuthCredentialStore {
  return (service as unknown as { credentials: PiAuthCredentialStore }).credentials;
}

function configurationServiceRuntime(service: PiConfigurationService): ModelRuntime | undefined {
  return (service as unknown as { modelRuntime?: ModelRuntime }).modelRuntime;
}
