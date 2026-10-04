import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import { installSessionProjectionFixture, sessionSnapshotFixture } from "./session-projection-test-support.js";
import { continueRendererInterruptedTask, inspectRendererInterruptedTask } from "./interrupted-task-controller.js";

const authority = { hostEpoch: 9, sessionId: "recovery-session", sessionFileIdentity: "recovery-file", sessionGeneration: 3 };
const accepted = { ...authority, kind: "accepted", operationId: "recovery-operation", cancellable: true };

describe("interrupted task controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
    rendererWorkbenchStore.setState(rendererWorkbenchStore.getInitialState(), true);
    useAppStore.setState({ connected: true, hostEpoch: 9, runtime: { phase: "ready", detail: "ready", recoverable: true } });
    installSessionProjectionFixture({ connected: true, hostEpoch: 9 }, sessionSnapshotFixture(authority), 3);
  });

  it("ignores inspection and acceptance after the active Session is replaced", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(() => new Promise(accept => { resolve = accept; }) as never);
    const inspected = inspectRendererInterruptedTask();
    useSessionProjectionStore.getState().reset();
    resolve({ status: "available", anchor: "leaf" });
    expect(await inspected).toBeUndefined();
    installSessionProjectionFixture({ connected: true, hostEpoch: 9 }, sessionSnapshotFixture(authority), 3);
    const pending = continueRendererInterruptedTask("leaf", "submission");
    useSessionProjectionStore.getState().reset();
    resolve(accepted);
    await expect(pending).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().operation).toBeUndefined();
  });

  it("starts a cancellable native prompt operation with identifiers only", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(accepted as never);
    await continueRendererInterruptedTask("leaf", "submission");
    expect(request).toHaveBeenCalledWith("session.recovery.continue", { anchor: "leaf", submissionId: "submission" });
    expect(useAppStore.getState()).toMatchObject({ operation: { operationId: "recovery-operation", kind: "prompt" }, runtime: { phase: "busy" } });
    expect(useLiveTurnStore.getState().authority).toMatchObject({ operationId: "recovery-operation" });
    await expect(continueRendererInterruptedTask("leaf", "other")).rejects.toThrow("尚未就绪");
    expect(request).toHaveBeenCalledOnce();
  });
});
