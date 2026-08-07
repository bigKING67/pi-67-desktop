import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  approveObservedExtensionPackage,
  declineExtensionPackageOnboarding,
  getExtensionPackageOnboarding,
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
      title: "扩展包操作暂不可用"
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

  it("allows content approval while Tasks are busy and reports deferred reload", async () => {
    rendererWorkbenchStore.getState().openTask(task("task-b", "workspace-b", "running"));
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [{
        source: "npm:example",
        scope: "global",
        enabled: true,
        filtered: false,
        installed: true,
        trustState: "user-approved-observed"
      }],
      total: 1,
      changed: true,
      receiptState: "active",
      reloadRequired: true
    } as never);

    await expect(approveObservedExtensionPackage("npm:example", "global", "workspace-a"))
      .resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "extension.package.approveObserved",
      { source: "npm:example", scope: "global" },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-a" } }
    );
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "扩展包内容已确认",
      message: expect.stringContaining("正在运行的任务继续使用原资源")
    });
  });

  it("reads and persists the prompt-once onboarding decision through Agent Host", async () => {
    const request = vi.spyOn(agentConnectionController, "request")
      .mockResolvedValueOnce({
        source: "npm:pi-observational-memory",
        scope: "global",
        state: "unseen"
      } as never)
      .mockResolvedValueOnce({
        source: "npm:pi-observational-memory",
        scope: "global",
        state: "declined"
      } as never);

    await expect(getExtensionPackageOnboarding(
      "npm:pi-observational-memory",
      "global",
      "workspace-a"
    )).resolves.toBe("unseen");
    await expect(declineExtensionPackageOnboarding(
      "npm:pi-observational-memory",
      "global",
      "workspace-a"
    )).resolves.toBe("declined");
    expect(request.mock.calls.map(([type]) => type)).toEqual([
      "extension.package.onboarding.get",
      "extension.package.onboarding.decline"
    ]);
  });

  it("rejects project mutation for an untrusted Workspace", async () => {
    rendererWorkbenchStore.getState().unregisterWorkspace("workspace-a");
    registerWorkspace("workspace-a", "/work/a", "untrusted");
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(installExtensionPackage("npm:example", "project", "workspace-a")).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "项目扩展包设置未更改"
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

  it("names the updated package and reports its version transition", async () => {
    const source = "npm:@example/pi-settings";
    const store = useExtensionPackageStore.getState();
    store.begin("workspace-a", "loading");
    store.installList("workspace-a", [{
      source,
      scope: "global",
      enabled: true,
      filtered: false,
      installed: true,
      displayName: "Pi Settings",
      version: "1.2.3",
      trustState: "user-installed-observed"
    }]);
    store.begin("workspace-a", "checking");
    store.installUpdates("workspace-a", [{
      source,
      scope: "global",
      type: "npm",
      displayName: "Pi Settings"
    }]);
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [{
        source,
        scope: "global",
        enabled: true,
        filtered: false,
        installed: true,
        displayName: "Pi Settings",
        version: "1.3.0"
      }],
      total: 1,
      changed: true
    } as never);

    await expect(updateExtensionPackage(source, "global", "workspace-a")).resolves.toBe(true);

    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "success",
      title: "Pi Settings 已更新",
      message: "1.2.3 → 1.3.0 · 全局扩展包 · Pi 资源已重新加载。"
    });
  });

  it("does not announce success when the durable package result is ambiguous", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [{
        source: "npm:example",
        scope: "global",
        enabled: true,
        filtered: false,
        installed: true,
        trustState: "unverified",
        trustReason: "mutation-ambiguous"
      }],
      total: 1,
      changed: true,
      receiptState: "ambiguous"
    } as never);

    await expect(installExtensionPackage("npm:example", "global", "workspace-a")).resolves.toBe(false);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "扩展包操作结果需要核对"
    });
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
      sessionFileIdentity: `session-file-${id}`,
      sessionPath: `/sessions/${id}.jsonl`
    },
    workspaceId,
    sessionId: `session-${id}`,
    taskGeneration: 1,
    lifecycle,
    runtime: { phase: "busy" as const, detail: "running", recoverable: true },
    title: id,
    hasDraft: false,
    toolMode: "auto" as const,
    attachmentCount: 0
  };
}
