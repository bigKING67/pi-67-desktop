import { AgentPortClient } from "@pi67/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createController, createHost, disposeAgentConnectionFixtures, FakeHandoffTarget, flushMessagePorts } from "./AgentConnectionController.test-fixture.js";

afterEach(disposeAgentConnectionFixtures);

it("loads the client only after a valid handoff and completes the real handshake", async () => {
  const target = new FakeHandoffTarget();
  const deferred = Promise.withResolvers<typeof AgentPortClient>();
  const loadPortClient = vi.fn(() => deferred.promise);
  const controller = createController(target, { loadPortClient });
  expect(loadPortClient).not.toHaveBeenCalled();
  const host = createHost(1);
  host.handoff(target, { origin: "https://attacker.invalid" });
  expect(loadPortClient).not.toHaveBeenCalled();
  host.handoff(target);
  expect(loadPortClient).toHaveBeenCalledOnce();
  expect(controller.hasOpenPort).toBe(false);
  expect(host.hello).toBeUndefined();
  deferred.resolve(AgentPortClient);
  await expect(controller.waitForConnection()).resolves.toMatchObject({ hostEpoch: 1 });
});

it("closes a superseded pending port and ignores its late module load", async () => {
  const target = new FakeHandoffTarget();
  const deferred = Promise.withResolvers<typeof AgentPortClient>();
  const controller = createController(target, { loadPortClient: () => deferred.promise });
  const oldHost = createHost(1);
  const close = vi.spyOn(oldHost.controllerPort, "close");
  oldHost.handoff(target);
  const currentHost = createHost(2);
  currentHost.handoff(target);
  expect(close).toHaveBeenCalled();
  deferred.resolve(AgentPortClient);
  await expect(controller.waitForConnection()).resolves.toMatchObject({ hostEpoch: 2 });
  expect(oldHost.hello).toBeUndefined();
});

it("closes a pending port on disposal without attaching after the module resolves", async () => {
  const target = new FakeHandoffTarget();
  const deferred = Promise.withResolvers<typeof AgentPortClient>();
  const controller = createController(target, { loadPortClient: () => deferred.promise });
  const host = createHost(1);
  const close = vi.spyOn(host.controllerPort, "close");
  host.handoff(target);
  controller.dispose();
  expect(close).toHaveBeenCalled();
  deferred.resolve(AgentPortClient);
  await flushMessagePorts();
  expect(host.hello).toBeUndefined();
  expect(controller.hasOpenPort).toBe(false);
});

it("rejects connection waiters on load failure and permits a fresh handoff", async () => {
  const target = new FakeHandoffTarget();
  const deferred = Promise.withResolvers<typeof AgentPortClient>();
  const loadPortClient = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue(AgentPortClient);
  const controller = createController(target, { loadPortClient });
  const onTeardown = vi.fn();
  controller.subscribe({ onTeardown });
  const host = createHost(1);
  const close = vi.spyOn(host.controllerPort, "close");
  host.handoff(target);
  const rejected = expect(controller.waitForConnection()).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
  deferred.reject(new Error("synthetic module load failure"));
  await rejected;
  expect(close).toHaveBeenCalled();
  expect(onTeardown).toHaveBeenCalledOnce();
  expect(controller.hasOpenPort).toBe(false);
  createHost(2).handoff(target);
  await expect(controller.waitForConnection()).resolves.toMatchObject({ hostEpoch: 2 });
});
