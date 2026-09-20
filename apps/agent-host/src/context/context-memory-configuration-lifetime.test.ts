import { afterEach, expect, it, vi } from "vitest";
import { ContextMemoryConfigurationStore } from "./context-memory-configuration.js";
import { EnterpriseContextController } from "./enterprise-context-controller.js";
import { cleanupRouterFixtures, createRouter } from "./context-memory-command-router.test-support.js";

afterEach(async () => { vi.restoreAllMocks(); await cleanupRouterFixtures(); });
it.each([false, true])("retires team channels after a configuration mutation even if final readback fails: %s", async (failReadback) => {
  const fixture = await createRouter();
  const store = new ContextMemoryConfigurationStore(fixture.root);
  const current = await store.read();
  const retire = vi.spyOn(EnterpriseContextController.prototype, "retireTeamModelChannels");
  const update = store.update.bind(store);
  if (failReadback) vi.spyOn(ContextMemoryConfigurationStore.prototype, "update").mockImplementation(async (input) => {
    await update(input);
    throw new Error("Synthetic post-persistence readback failure");
  });
  const request = fixture.router.dispatchApp({ type: "context.config.update", payload: {
    ...current, expectedRevision: current.revision, recallTokenBudget: current.recallTokenBudget + 1
  } }, "fixture-config-change");
  if (failReadback) await expect(request).rejects.toThrow("readback failure");
  else await expect(request).resolves.toHaveProperty("recallTokenBudget", current.recallTokenBudget + 1);
  expect((await store.read()).recallTokenBudget).toBe(current.recallTokenBudget + 1);
  expect(retire).toHaveBeenCalledOnce();
});
