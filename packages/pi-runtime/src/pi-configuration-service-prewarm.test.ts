import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { installFirstPartyModelProviders } from "./first-party-model-providers.js";
import { PiAuthCredentialStore } from "./pi-auth-credential-store.js";
import {
  createPiConfigurationFixture,
  waitForConfiguration
} from "./pi-configuration-service-test-fixture.js";

describe("PiConfigurationService model runtime prewarm", () => {
  it("loads auth before reusing one revision-bound runtime for validation and Task startup", async () => {
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
      .mockResolvedValueOnce(nextRuntime);
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
      expect(createRuntime).toHaveBeenCalledOnce();

      await expect(fixture.service.createModelRuntime()).resolves.toBe(nextRuntime);
      expect(createRuntime).toHaveBeenCalledTimes(2);
    } finally {
      loadContent.mockRestore();
      createRuntime.mockRestore();
      await fixture.dispose();
    }
  }, 20_000);
});
