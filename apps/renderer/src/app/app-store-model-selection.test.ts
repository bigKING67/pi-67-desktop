import type { CommandResults } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { selectSessionModel, setSessionThinkingLevel } from "../session/session-control-controller.js";
import {
  recentSessionRuntimePreference,
  resetRecentSessionRuntimePreferencesForTests
} from "../session/recent-session-runtime-preferences.js";
import { useModelSelectionStore } from "../session/model-selection-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  deferred, emitMeta, installSession, installWorkbenchSession,
  modelSelectionResult, resetStores, resyncResult
} from "./app-store-session-control-test-support.js";

describe("model selection catalog confirmation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStores();
    installSession("session-1", 3);
    rendererWorkbenchStore.getState().reset();
    resetRecentSessionRuntimePreferencesForTests();
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app-1",
      hostInstanceId: "host-9",
      hostEpoch: 9,
      sdkVersion: "0.81.1",
      eventSequence: 0
    });
  });

  it("waits for the complete catalog when matching model metadata arrives before the ACK", async () => {
    installWorkbenchSession();
    const request = deferred<CommandResults["model.select"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);
    const selecting = selectSessionModel("pi67-auto", "auto");
    emitMeta("Auto selected", { provider: "pi67-auto", id: "auto" }, "medium");

    expect(useModelSelectionStore.getState().status).toBe("pending");
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
    request.resolve(modelSelectionResult("session-1", { provider: "pi67-auto", id: "auto" }, "high", levels));

    await expect(selecting).resolves.toBe(true);
    expect(useSessionProjectionStore.getState()).toMatchObject({
      controls: { selectedModel: { provider: "pi67-auto", id: "auto" }, thinkingLevel: "medium" },
      modelCatalog: { availableThinkingLevels: levels }
    });
    expect(useModelSelectionStore.getState().status).toBe("confirmed");
    expect(recentSessionRuntimePreference("workspace-a")).toMatchObject({
      model: { provider: "pi67-auto", model: "auto" }, thinkingLevel: "medium"
    });
  });

  it("resynchronizes when a catalog event makes the complete selection ACK stale", async () => {
    const request = deferred<CommandResults["model.select"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);
    const resync = vi.spyOn(agentConnectionController, "resyncProjection")
      .mockImplementation(async (install) => install(resyncResult({ provider: "anthropic", id: "claude" })));
    const selecting = selectSessionModel("anthropic", "claude");
    const projection = useSessionProjectionStore.getState();
    useSessionProjectionStore.setState({
      revisions: { ...projection.revisions, modelCatalog: projection.revisions.modelCatalog + 1 }
    });
    emitMeta("Selected metadata", { provider: "anthropic", id: "claude" }, "high");
    request.resolve(modelSelectionResult("session-1", { provider: "anthropic", id: "claude" }));

    await expect(selecting).resolves.toBe(true);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(useModelSelectionStore.getState().status).toBe("confirmed");
  });

  it("does not treat matching metadata as recovery from a failed model selection", async () => {
    const send = vi.spyOn(agentConnectionController, "request")
      .mockRejectedValueOnce(new Error("fixture failure") as never)
      .mockResolvedValueOnce(modelSelectionResult("session-1", { provider: "pi67-auto", id: "auto" }) as never);
    await expect(selectSessionModel("pi67-auto", "auto")).resolves.toBe(false);
    emitMeta("Late metadata", { provider: "pi67-auto", id: "auto" }, "high");
    expect(useModelSelectionStore.getState().status).toBe("failed");
    await expect(selectSessionModel("pi67-auto", "auto")).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("recovers a failed selection only from controls and catalog installed together", async () => {
    const initial = useSessionProjectionStore.getState();
    if (initial.authority.phase !== "active") throw new Error("Expected active fixture");
    const oldTarget = initial.capture(initial.authority)!;
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("fixture failure") as never);
    await expect(selectSessionModel("pi67-auto", "auto")).resolves.toBe(false);
    emitMeta("Late metadata", { provider: "pi67-auto", id: "auto" }, "medium");
    useSessionProjectionStore.getState().applyModelCatalogResult(oldTarget, modelSelectionResult(
      "session-1", { provider: "anthropic", id: "claude" }, "high", ["off", "high", "max"]
    ));
    expect(useModelSelectionStore.getState().status).toBe("failed");
    const current = useSessionProjectionStore.getState();
    if (current.authority.phase !== "active") throw new Error("Expected active fixture");
    current.applyModelCatalogResult(current.capture(current.authority)!, modelSelectionResult(
      "session-1", { provider: "pi67-auto", id: "auto" }, "medium", ["off", "minimal", "low", "medium", "high", "xhigh"]
    ));
    expect(useModelSelectionStore.getState().status).toBe("confirmed");
  });

  it("confirms thinking when matching metadata arrives before its acknowledgement", async () => {
    const request = deferred<CommandResults["thinking.set"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);
    const setting = setSessionThinkingLevel("max");
    emitMeta("Thinking updated", { provider: "openai", id: "gpt" }, "max");
    request.resolve({ sessionId: "session-1", controls: {
      selectedModel: { provider: "openai", id: "gpt" }, thinkingLevel: "max"
    } });
    await expect(setting).resolves.toBe(true);
  });

  it("does not confirm thinking against a newer different model", async () => {
    const request = deferred<CommandResults["thinking.set"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);
    const setting = setSessionThinkingLevel("high");
    emitMeta("New model", { provider: "anthropic", id: "claude" }, "high");
    request.resolve({ sessionId: "session-1", controls: {
      selectedModel: { provider: "openai", id: "gpt" }, thinkingLevel: "high"
    } });
    await expect(setting).resolves.toBe(false);
    expect(useSessionProjectionStore.getState().controls?.selectedModel).toEqual({ provider: "anthropic", id: "claude" });
  });

  it("rejects a thinking acknowledgement for another Session even after matching metadata", async () => {
    installWorkbenchSession();
    const request = deferred<CommandResults["thinking.set"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);
    const setting = setSessionThinkingLevel("max");
    emitMeta("Thinking updated", { provider: "openai", id: "gpt" }, "max");
    request.resolve({ sessionId: "session-2", controls: {
      selectedModel: { provider: "openai", id: "gpt" }, thinkingLevel: "max"
    } });
    await expect(setting).resolves.toBe(false);
    expect(recentSessionRuntimePreference("workspace-a")).toBeUndefined();
  });
});
