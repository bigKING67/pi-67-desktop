import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { installFirstPartyModelProviders } from "./first-party-model-providers.js";
import { PiAuthCredentialStore } from "./pi-auth-credential-store.js";
import {
  configurationDelay,
  createPiConfigurationFixture,
  deferredConfigurationValue,
  waitForConfiguration
} from "./pi-configuration-service-test-fixture.js";

describe("PiConfigurationService model runtime prewarm", () => {
  it("loads auth before reusing revision-bound runtimes and keeps one Task standby warm", async () => {
    const fixture = await createPiConfigurationFixture({
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000,
      initialAuthContent: `${JSON.stringify({
        anthropic: { type: "api_key", key: "prewarm-fixture-credential" }
      })}\n`
    });
    const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
    await installFirstPartyModelProviders(runtime);
    const nextRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
    await installFirstPartyModelProviders(nextRuntime);
    const standbyRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
    await installFirstPartyModelProviders(standbyRuntime);
    const initializationOrder: string[] = [];
    const loadContent = vi.spyOn(PiAuthCredentialStore.prototype, "loadContent")
      .mockImplementation(() => {
        initializationOrder.push("auth");
        return undefined;
      });
    const createRuntime = vi.spyOn(ModelRuntime, "create")
      .mockImplementationOnce(async () => {
        initializationOrder.push("runtime");
        return runtime;
      })
      .mockResolvedValueOnce(nextRuntime)
      .mockResolvedValueOnce(standbyRuntime);
    try {
      fixture.service.prewarmModelRuntime();
      await waitForConfiguration(() => createRuntime.mock.calls.length === 1);
      expect(initializationOrder.slice(0, 2)).toEqual(["auth", "runtime"]);
      const [snapshot, taskRuntime] = await Promise.all([
        fixture.service.get(fixture.cwd),
        fixture.service.createModelRuntime()
      ]);

      expect(snapshot.syncState).toBe("current");
      expect(taskRuntime).toBe(runtime);
      await waitForConfiguration(() => createRuntime.mock.calls.length === 2);

      await expect(fixture.service.createModelRuntime()).resolves.toBe(nextRuntime);
      await waitForConfiguration(() => createRuntime.mock.calls.length === 3);
    } finally {
      loadContent.mockRestore();
      createRuntime.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);

  it("settles an active standby load before disposal releases the shared Pi Profile", async () => {
    const fixture = await createPiConfigurationFixture({
      fallbackPollMs: 60_000,
      watchDebounceMs: 60_000
    });
    const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
    await installFirstPartyModelProviders(runtime);
    const runtimeLoad = deferredConfigurationValue<ModelRuntime>();
    const createRuntime = vi.spyOn(ModelRuntime, "create").mockReturnValue(runtimeLoad.promise);
    try {
      fixture.service.prewarmModelRuntime();
      await waitForConfiguration(() => createRuntime.mock.calls.length === 1);

      let disposed = false;
      const disposal = fixture.service.dispose().then(() => { disposed = true; });
      await configurationDelay(20);
      expect(disposed).toBe(false);

      runtimeLoad.resolve(runtime);
      await disposal;
      expect(disposed).toBe(true);
    } finally {
      createRuntime.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);
});
