import type { SkillPackEntry } from "@pi67/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  checkSkillPackUpdates,
  installSkillPack,
  loadSkillPacks,
  restoreSkillPack,
  updateSkillPack
} from "./skill-pack-controller.js";
import { useSkillPackStore } from "./skill-pack-store.js";

const PACK: SkillPackEntry = {
  id: "lark-cli-global",
  suiteId: "lark-cli",
  displayName: "飞书 Lark CLI",
  description: "飞书文档、消息、日历和开放平台能力。",
  manager: "lark-cli",
  managerStatus: "ready",
  updateOwner: "managed-pack",
  updateStatus: "update-available",
  localState: "clean",
  provenance: "verified",
  installed: true,
  installedSkillCount: 27,
  skillIds: ["lark-doc", "lark-calendar"],
  canInstall: false,
  canUpdate: true,
  effectiveSource: "managed",
  canRestore: false,
  installedVersion: "1.0.65",
  latestVersion: "1.0.80",
  source: "@larksuite/cli"
};

describe("Skill Pack controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rendererWorkbenchStore.getState().reset();
    useSkillPackStore.getState().reset();
    useNotificationStore.getState().clear();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-skills",
      displayName: "Skills",
      identity: { canonicalPath: "/work/skills", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 2,
      sdkVersion: "fixture",
      eventSequence: 0
    });
  });

  it("loads and checks one Pack through Workspace authority", async () => {
    const request = vi.spyOn(agentConnectionController, "request")
      .mockResolvedValueOnce({ items: [{ ...PACK, updateStatus: "not-checked", canUpdate: false }], total: 1 } as never)
      .mockResolvedValueOnce({ items: [PACK], total: 1, checkedAt: 1_722_400_000_000 } as never);

    await expect(loadSkillPacks("workspace-skills")).resolves.toBe(true);
    await expect(checkSkillPackUpdates("workspace-skills")).resolves.toBe(true);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "skill.pack.checkUpdates",
      {},
      [],
      { context: { scope: "workspace", workspaceId: "workspace-skills" } }
    );
    expect(useSkillPackStore.getState()).toMatchObject({
      phase: "idle",
      checkedAt: 1_722_400_000_000,
      items: [{ updateStatus: "update-available", latestVersion: "1.0.80" }]
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "技能更新检查完成",
      message: "发现 1 个可更新的技能套件。"
    });
  });

  it("blocks the global update while any Task consumes a run slot", async () => {
    rendererWorkbenchStore.getState().openTask({
      id: "task-running",
      conversation: {
        kind: "session",
        workspaceId: "workspace-skills",
        sessionFileIdentity: "session-file-task",
        sessionPath: "/sessions/task.jsonl"
      },
      workspaceId: "workspace-skills",
      sessionId: "session-running",
      taskGeneration: 1,
      lifecycle: "running",
      runtime: { phase: "busy", detail: "running", recoverable: true },
      title: "running",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    });
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(updateSkillPack(PACK.id, "workspace-skills")).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "技能套件暂不可更改"
    });
  });

  it("installs a missing Lark CLI through the replay-safe Workspace command", async () => {
    const current = {
      ...PACK,
      managerStatus: "ready" as const,
      updateStatus: "current" as const,
      canInstall: false,
      canUpdate: false,
      installedVersion: "1.0.85",
      latestVersion: "1.0.85"
    };
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [current],
      total: 1,
      changed: true,
      checkedAt: 1_722_400_000_050
    } as never);

    await expect(installSkillPack(PACK.id, "workspace-skills")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "skill.pack.install",
      { id: PACK.id },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-skills" } }
    );
    expect(useSkillPackStore.getState().items).toEqual([current]);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "Lark CLI 已安装",
      message: expect.stringContaining("~/.agents/skills")
    });
  });

  it("installs the verified post-update inventory", async () => {
    const current = {
      ...PACK,
      updateStatus: "current" as const,
      canUpdate: false,
      installedVersion: "1.0.80"
    };
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [current],
      total: 1,
      changed: true,
      checkedAt: 1_722_400_000_100
    } as never);

    await expect(updateSkillPack(PACK.id, "workspace-skills")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "skill.pack.update",
      { id: PACK.id },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-skills" } }
    );
    expect(useSkillPackStore.getState().items).toEqual([current]);
  });

  it("rechecks after an update failure instead of preserving a stale current state", async () => {
    const staleCurrent = {
      ...PACK,
      updateStatus: "current" as const,
      canUpdate: false,
      installedVersion: "1.0.80",
      installedSkillVersion: "1.0.80"
    };
    const actual = {
      ...PACK,
      installedSkillVersion: "1.0.80",
      detail: "当前 CLI 1.0.65 待更新；官方 Skills 已是 1.0.80。"
    };
    useSkillPackStore.getState().begin("workspace-skills", "loading");
    useSkillPackStore.getState().install("workspace-skills", [staleCurrent]);
    const request = vi.spyOn(agentConnectionController, "request")
      .mockRejectedValueOnce(new Error("The Lark CLI update did not converge at the same verified installation."))
      .mockResolvedValueOnce({
        items: [actual],
        total: 1,
        checkedAt: 1_722_400_000_300
      } as never);

    await expect(updateSkillPack(PACK.id, "workspace-skills")).resolves.toBe(false);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "skill.pack.checkUpdates",
      {},
      [],
      { context: { scope: "workspace", workspaceId: "workspace-skills" } }
    );
    expect(useSkillPackStore.getState()).toMatchObject({
      phase: "failed",
      error: "The Lark CLI update did not converge at the same verified installation.",
      items: [{
        installedVersion: "1.0.65",
        installedSkillVersion: "1.0.80",
        updateStatus: "update-available",
        canUpdate: true
      }]
    });
  });

  it("restores a managed Overlay through the replay-safe Workspace command", async () => {
    const bundled = {
      ...PACK,
      id: "ai-berkshire-investment-suite",
      suiteId: "ai-berkshire-investment-suite",
      effectiveSource: "bundled" as const,
      canRestore: false,
      canUpdate: false,
      baselineVersion: "1.0.1",
      installedVersion: "1.0.1",
      latestVersion: "1.0.2",
      updateStatus: "not-checked" as const
    };
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      items: [bundled],
      total: 1,
      changed: true,
      checkedAt: 1_722_400_000_200
    } as never);

    await expect(restoreSkillPack(bundled.id, "workspace-skills")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "skill.pack.restore",
      { id: bundled.id },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-skills" } }
    );
    expect(useSkillPackStore.getState().items).toEqual([bundled]);
  });
});
