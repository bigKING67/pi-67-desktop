import { eventEnvelope } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { createOperationFreshnessInstallation } from "./operation-freshness-installation.js";

describe("operation freshness installation", () => {
  it("loads once on activation, forwards events and disposes on deactivation", async () => {
    const controller = controllerFixture();
    const load = vi.fn(async () => controller.module);
    const installation = createOperationFreshnessInstallation({ load });

    installation.activate();
    installation.activate();
    await Promise.resolve();

    const event = heartbeatEvent();
    const envelope = heartbeatEnvelope();
    installation.observe(event, envelope);
    installation.handlePowerResume();

    expect(load).toHaveBeenCalledTimes(1);
    expect(controller.install).toHaveBeenCalledTimes(1);
    expect(controller.observe).toHaveBeenCalledWith(event, envelope);
    expect(controller.resume).toHaveBeenCalledTimes(1);

    installation.deactivate();
    installation.observe(event, envelope);
    installation.handlePowerResume();

    expect(controller.dispose).toHaveBeenCalledTimes(1);
    expect(controller.observe).toHaveBeenCalledTimes(1);
    expect(controller.resume).toHaveBeenCalledTimes(1);
  });

  it("does not install a controller whose dynamic import resolves after cleanup", async () => {
    const controller = controllerFixture();
    const deferred = Promise.withResolvers<typeof controller.module>();
    const installation = createOperationFreshnessInstallation({ load: () => deferred.promise });

    installation.activate();
    installation.deactivate();
    deferred.resolve(controller.module);
    await deferred.promise;
    await Promise.resolve();

    expect(controller.install).not.toHaveBeenCalled();
  });

  it("installs only the latest activation when imports overlap", async () => {
    const staleController = controllerFixture();
    const currentController = controllerFixture();
    const staleLoad = Promise.withResolvers<typeof staleController.module>();
    const currentLoad = Promise.withResolvers<typeof currentController.module>();
    const load = vi.fn()
      .mockReturnValueOnce(staleLoad.promise)
      .mockReturnValueOnce(currentLoad.promise);
    const installation = createOperationFreshnessInstallation({ load });

    installation.activate();
    installation.deactivate();
    installation.activate();
    staleLoad.resolve(staleController.module);
    currentLoad.resolve(currentController.module);
    await Promise.all([staleLoad.promise, currentLoad.promise]);
    await Promise.resolve();

    expect(staleController.install).not.toHaveBeenCalled();
    expect(currentController.install).toHaveBeenCalledTimes(1);
  });

  it("reports an active load failure without exposing the rejected error", async () => {
    const onLoadFailed = vi.fn();
    const installation = createOperationFreshnessInstallation({
      load: () => Promise.reject(new Error("sensitive local path")),
      onLoadFailed
    });

    installation.activate();
    await Promise.resolve();
    await Promise.resolve();

    expect(onLoadFailed).toHaveBeenCalledWith();
  });
});

function controllerFixture() {
  const dispose = vi.fn();
  const install = vi.fn(() => dispose);
  const observe = vi.fn();
  const resume = vi.fn();
  return {
    dispose,
    install,
    observe,
    resume,
    module: {
      installOperationFreshnessController: install,
      observeOperationFreshnessEvent: observe,
      resetOperationFreshnessAfterPowerResume: resume
    }
  };
}

function heartbeatEvent() {
  return {
    type: "operation.heartbeat",
    payload: { operationId: "operation-1", observedAt: 105_000, lastActivityAt: 105_000 }
  } as const;
}

function heartbeatEnvelope() {
  return eventEnvelope("operation.heartbeat", {
    operationId: "operation-1",
    observedAt: 105_000,
    lastActivityAt: 105_000
  }, {
    hostEpoch: 9,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1"
  });
}
