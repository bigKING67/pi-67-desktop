import type { OperationKind, SessionSnapshot } from "@pi67/domain";
import type { OperationSettled } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  compactRendererSession,
  invokeRuntimeCommand
} from "../operation/operation-controller.js";
import { useApprovalStore } from "../approval/approval-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useAppStore } from "./app-store.js";

describe("renderer Operation submission replay", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ connected: true, hostEpoch: 9 });
    installSessionProjectionFixture(useAppStore.getState(), snapshot(), 3);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("applies a failed command receipt without returning to busy", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      terminalReceipt("operation-failed", "command", "failed") as never
    );

    await invokeRuntimeCommand("inspect");

    expect(useAppStore.getState().operation).toMatchObject({
      operationId: "operation-failed",
      lifecycle: "failed",
      cancellable: false
    });
    expect(useAppStore.getState().runtime).toMatchObject({ phase: "failed", detail: "Structured failure" });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "任务失败",
      message: "Pi 命令 · 错误代码 INTERNAL"
    });
  });

  it("applies a lost compaction receipt as recoverable interruption", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      terminalReceipt("operation-lost", "compaction", "lost") as never
    );

    await compactRendererSession("keep decisions");

    expect(request).toHaveBeenCalledWith("session.compact", expect.objectContaining({
      instructions: "keep decisions"
    }));
    expect(useAppStore.getState().operation).toMatchObject({
      operationId: "operation-lost",
      lifecycle: "lost",
      cancellable: false
    });
    expect(useAppStore.getState().runtime).toMatchObject({ phase: "recovering", detail: "Runtime replaced" });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "任务已中断",
      message: "上下文压缩 · Pi 运行服务未能确认任务终态"
    });
  });

  it("drops an accepted command response after the Session authority changes", async () => {
    let resolveCommand!: (value: unknown) => void;
    vi.spyOn(agentConnectionController, "request").mockReturnValue(new Promise((resolve) => {
      resolveCommand = resolve;
    }) as never);

    const invoking = invokeRuntimeCommand("inspect");
    installSessionProjectionFixture(useAppStore.getState(), snapshot("session-2"), 4);
    resolveCommand({
      kind: "accepted",
      operationId: "operation-stale",
      cancellable: false,
      hostEpoch: 9,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-1",
      sessionGeneration: 3
    });
    await invoking;

    expect(useAppStore.getState().operation).toBeUndefined();
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      sessionId: "session-2",
      sessionGeneration: 4
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "命令 /inspect 确认已过期"
    });
  });
});

function terminalReceipt(
  operationId: string,
  operationKind: OperationKind,
  lifecycle: OperationSettled["lifecycle"]
): OperationSettled {
  const base = {
    kind: "settled" as const,
    operationId,
    operationKind,
    cancellable: false as const,
    hostEpoch: 9,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 3,
    startedAt: 10,
    settledAt: 20
  };
  if (lifecycle === "failed") {
    return {
      ...base,
      lifecycle,
      error: { code: "INTERNAL", message: "Structured failure", recoverable: true }
    };
  }
  if (lifecycle === "cancelled" || lifecycle === "lost") {
    return { ...base, lifecycle, reason: lifecycle === "lost" ? "Runtime replaced" : "Cancelled" };
  }
  return { ...base, lifecycle };
}

function snapshot(sessionId = "session-1"): SessionSnapshot {
  return {
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSessionCatalogStore.getState().reset();
  useConversationStore.getState().reset();
  useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
  useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  useLiveTurnStore.getState().reset();
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
}
