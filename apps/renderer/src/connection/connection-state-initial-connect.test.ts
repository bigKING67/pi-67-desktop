import type { AgentConnectionIdentity } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

const CONNECTION: AgentConnectionIdentity = {
  appInstanceId: "app-1",
  hostInstanceId: "host-1",
  hostEpoch: 1,
  sdkVersion: "0.83.0",
  eventSequence: 0
};

describe("initial Agent Host connection state", () => {
  beforeEach(resetStores);
  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("clears a stale connection-recovery status after the first successful handshake", () => {
    registerWorkspaceAndSelectColdSession();
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      hostEpoch: undefined,
      runtime: {
        phase: "recovering",
        detail: "Pi 运行服务连接已中断，正在等待恢复",
        recoverable: true
      }
    });

    useAppStore.getState().handleAgentConnected(CONNECTION);

    expect(useAppStore.getState()).toMatchObject({
      connected: true,
      hostEpoch: 1,
      sessionTransitionPending: false,
      runtime: { phase: "stopped", detail: "会话待打开" }
    });
  });

  it("does not overwrite a caller-owned first-connection transition", () => {
    registerWorkspaceAndSelectColdSession();
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      hostEpoch: undefined,
      sessionTransitionPending: true,
      runtime: {
        phase: "recovering",
        detail: "正在恢复 Pi 会话",
        recoverable: true
      }
    });

    useAppStore.getState().handleAgentConnected(CONNECTION);

    expect(useAppStore.getState().runtime).toMatchObject({
      phase: "recovering",
      detail: "正在恢复 Pi 会话"
    });
  });

  it("restores a Workspace-only surface without inventing Session recovery authority", () => {
    registerWorkspaceOnly();
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      hostEpoch: 1,
      runtime: {
        phase: "recovering",
        detail: "Pi 运行服务连接已中断，正在等待恢复",
        recoverable: true
      }
    });

    useAppStore.getState().handleAgentConnected({ ...CONNECTION, hostEpoch: 2 });

    expect(useAppStore.getState()).toMatchObject({
      connected: true,
      hostEpoch: 2,
      sessionTransitionPending: false,
      runtime: { phase: "stopped", detail: "工作区已恢复" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("keeps a repeated same-Host handshake inert for a Workspace-only surface", () => {
    registerWorkspaceOnly();
    useAppStore.setState({
      workspace: "/workspace",
      connected: true,
      connectionIdentity: CONNECTION,
      hostEpoch: CONNECTION.hostEpoch,
      runtime: { phase: "stopped", detail: "工作区已恢复", recoverable: true }
    });

    useAppStore.getState().handleAgentConnected(CONNECTION);

    expect(useAppStore.getState()).toMatchObject({
      connected: true,
      hostEpoch: CONNECTION.hostEpoch,
      sessionTransitionPending: false,
      runtime: { phase: "stopped", detail: "工作区已恢复" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("does not recover a Workspace-only surface because another Workspace has a Session Task", () => {
    registerWorkspaceOnly();
    registerBackgroundSessionTask();
    rendererWorkbenchStore.getState().selectWorkspace("workspace-1");
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      hostEpoch: 1,
      runtime: {
        phase: "recovering",
        detail: "Pi 运行服务连接已中断，正在等待恢复",
        recoverable: true
      }
    });

    useAppStore.getState().handleAgentConnected({ ...CONNECTION, hostEpoch: 2 });

    expect(useAppStore.getState()).toMatchObject({
      connected: true,
      hostEpoch: 2,
      sessionTransitionPending: false,
      runtime: { phase: "stopped", detail: "工作区已恢复" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("fails closed when a Session recovery identity has no authoritative Task", () => {
    registerWorkspaceOnly();
    useSessionProjectionStore.setState({
      recoverySessionFileIdentity: "session-file-orphaned",
      recoverySessionPath: "/sessions/orphaned.jsonl"
    });
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      hostEpoch: 1,
      runtime: {
        phase: "recovering",
        detail: "Pi 运行服务连接已中断，正在等待恢复",
        recoverable: true
      }
    });

    useAppStore.getState().handleAgentConnected({ ...CONNECTION, hostEpoch: 2 });

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: expect.stringContaining("No authoritative Workbench Task")
      }
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法恢复 Pi 会话"
    });
  });
});

function registerWorkspaceOnly(): void {
  rendererWorkbenchStore.getState().registerWorkspace({
    id: "workspace-1",
    displayName: "Workspace",
    identity: { canonicalPath: "/workspace", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  });
}

function registerWorkspaceAndSelectColdSession(): void {
  registerWorkspaceOnly();
  const workbench = rendererWorkbenchStore.getState();
  workbench.selectConversation({
    kind: "session",
    workspaceId: "workspace-1",
    sessionFileIdentity: "session-file-1",
    sessionPath: "/sessions/session-1.jsonl"
  });
}

function registerBackgroundSessionTask(): void {
  const workbench = rendererWorkbenchStore.getState();
  workbench.registerWorkspace({
    id: "workspace-2",
    displayName: "Background Workspace",
    identity: { canonicalPath: "/background", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  });
  workbench.restoreTask({
    id: "task-background",
    conversation: {
      kind: "session",
      workspaceId: "workspace-2",
      sessionFileIdentity: "session-file-background",
      sessionPath: "/sessions/background.jsonl"
    },
    workspaceId: "workspace-2",
    sessionId: "session-background",
    taskGeneration: 1,
    lifecycle: "idle",
    runtime: { phase: "stopped", detail: "会话待打开", recoverable: true },
    title: "Background Session",
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto",
    sessionFileIdentity: "session-file-background",
    sessionPath: "/sessions/background.jsonl"
  });
}

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}
