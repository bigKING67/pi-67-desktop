import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  installExtensionPackage,
  loadExtensionPackages,
  setExtensionPackageEnabled,
  updateExtensionPackage
} from "./extension-package-controller.js";
import { useExtensionPackageStore } from "./extension-package-store.js";

describe("Extension package controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rendererWorkbenchStore.getState().reset();
    useExtensionPackageStore.getState().reset();
    useNotificationStore.getState().clear();
    registerWorkspace("workspace-a", "/work/a", "trusted");
    registerWorkspace("workspace-b", "/work/b", "trusted");
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 2,
      sdkVersion: "fixture",
      eventSequence: 0
    });
  });

  it("loads configured packages with explicit Workspace authority", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [{
        source: "npm:example",
        scope: "global",
        enabled: true,
        filtered: false,
        installed: true
      }],
      total: 1
    } as never);

    await expect(loadExtensionPackages("workspace-a")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "extension.package.list",
      {},
      [],
      { context: { scope: "workspace", workspaceId: "workspace-a" } }
    );
    expect(useExtensionPackageStore.getState()).toMatchObject({
      workspaceId: "workspace-a",
      phase: "idle",
      items: [{ source: "npm:example" }]
    });
  });

  it("blocks global mutation while any Workspace has a running task", async () => {
    rendererWorkbenchStore.getState().openTask(task("task-b", "workspace-b", "running"));
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(installExtensionPackage("npm:example", "global", "workspace-a")).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "Extension 操作暂不可用"
    });
  });

  it("allows project mutation when only another Workspace is busy", async () => {
    rendererWorkbenchStore.getState().openTask(task("task-b", "workspace-b", "running"));
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [{
        source: "npm:example",
        scope: "project",
        enabled: false,
        filtered: true,
        installed: true
      }],
      total: 1,
      changed: true
    } as never);

    await expect(setExtensionPackageEnabled(
      "npm:example",
      "project",
      false,
      "workspace-a"
    )).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "extension.package.setEnabled",
      { source: "npm:example", scope: "project", enabled: false, resourceType: "extension" },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-a" } }
    );
  });

  it("rejects project mutation for an untrusted Workspace", async () => {
    rendererWorkbenchStore.getState().unregisterWorkspace("workspace-a");
    registerWorkspace("workspace-a", "/work/a", "untrusted");
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(installExtensionPackage("npm:example", "project", "workspace-a")).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "项目 Extension 设置未更改"
    });
  });

  it("clears a consumed update after the package mutation succeeds", async () => {
    const source = "npm:example";
    const store = useExtensionPackageStore.getState();
    store.begin("workspace-a", "checking");
    store.installUpdates("workspace-a", [{ source, scope: "global", type: "npm", displayName: "example" }]);
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [{ source, scope: "global", enabled: true, filtered: false, installed: true }],
      total: 1,
      changed: true
    } as never);

    await expect(updateExtensionPackage(source, "global", "workspace-a")).resolves.toBe(true);
    expect(useExtensionPackageStore.getState().updates).toEqual([]);
  });
});

function registerWorkspace(
  id: string,
  canonicalPath: string,
  trust: "trusted" | "untrusted"
): void {
  rendererWorkbenchStore.getState().registerWorkspace({
    id,
    displayName: id,
    identity: { canonicalPath, assurance: "filesystem" },
    trust,
    trustProvenance: "native-picker",
    availability: "available"
  });
}

function task(id: string, workspaceId: string, lifecycle: "running") {
  return {
    id,
    conversation: {
      kind: "session" as const,
      workspaceId,
      sessionPath: `/sessions/${id}.jsonl`
    },
    workspaceId,
    sessionId: `session-${id}`,
    taskGeneration: 1,
    lifecycle,
    runtime: { phase: "busy" as const, detail: "running", recoverable: true },
    title: id,
    hasDraft: false,
    attachmentCount: 0
  };
}
