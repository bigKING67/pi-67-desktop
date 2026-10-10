import { beforeEach, describe, expect, it } from "vitest";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { selectAuthoritativeRecoveryTask } from "./projection-recovery-task-selection.js";

const descriptor = (id: string, path: string) => ({
  id, displayName: path.split("/").at(-1)!, identity: { canonicalPath: path, assurance: "filesystem" as const },
  trust: "trusted" as const, trustProvenance: "native-picker" as const, availability: "available" as const
});

beforeEach(() => {
  const store = rendererWorkbenchStore.getState();
  store.reset();
  store.registerImageLibrary(descriptor("image-library", "/work/library"));
  // The project-page conversation the Host recovers after a restart.
  store.openTask({
    id: "dock", workspaceId: "image-library", sessionId: "s", taskGeneration: 1, lifecycle: "stopped",
    conversation: { kind: "session", workspaceId: "image-library", sessionFileIdentity: "dock-file", sessionPath: "/sessions/dock.jsonl" },
    runtime: { phase: "stopped", detail: "会话尚未运行", recoverable: true }, title: "春日茶礼", sessionPath: "/sessions/dock.jsonl",
    hasDraft: false, toolMode: "auto", attachmentCount: 0, recoveryHostInstanceId: "host", recoveryHostEpoch: 1
  });
  rendererWorkbenchStore.setState({ selectedSurface: undefined, currentWorkspaceId: undefined });
});

describe("projection recovery selection", () => {
  it("never falls back to the hidden creative library as the current Workspace", () => {
    selectAuthoritativeRecoveryTask("dock-file")?.restore();
    expect(rendererWorkbenchStore.getState()).toMatchObject({ selectedSurface: undefined, currentWorkspaceId: undefined });
  });

  it("falls back to the first visible Workspace when there is one", () => {
    rendererWorkbenchStore.getState().registerWorkspace(descriptor("workspace-a", "/work/a"));
    rendererWorkbenchStore.setState({ selectedSurface: undefined, currentWorkspaceId: undefined, workspaceOrder: ["image-library", "workspace-a"] });
    selectAuthoritativeRecoveryTask("dock-file")?.restore();
    expect(rendererWorkbenchStore.getState().currentWorkspaceId).toBe("workspace-a");
  });
});
