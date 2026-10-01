import type { RepositoryEnvironmentSnapshot, WorkspaceDescriptor } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import { chatMessageWorkBrief, currentBranchName, handoffReferences, isHandoffLink, startTeamWork } from "./team-chat-work-bridge.js";

const workspace = { id: "w1", availability: "available" } as WorkspaceDescriptor;
const scope = { teamId: "t1", projectId: "p1" };

function dependencies(taskId: string | undefined, target: WorkspaceDescriptor | undefined = workspace) {
  return {
    workspace: vi.fn(() => target),
    showWork: vi.fn(),
    beginDraft: vi.fn(async () => taskId),
    setDraftText: vi.fn()
  };
}

describe("team chat work bridge", () => {
  it("opens a team-scoped draft in the chosen Workspace and fills it without sending", async () => {
    const deps = dependencies("task-1");
    await expect(startTeamWork({ workspaceId: "w1", teamScope: scope, text: "任务：t" }, deps)).resolves.toBe("started");
    expect(deps.showWork).toHaveBeenCalledOnce();
    expect(deps.beginDraft).toHaveBeenCalledWith(workspace, scope);
    expect(deps.setDraftText).toHaveBeenCalledWith("task-1", "任务：t");
  });

  it("reports busy or unavailable Workspaces without touching drafts", async () => {
    const busy = dependencies(undefined);
    await expect(startTeamWork({ workspaceId: "w1", teamScope: scope, text: "x" }, busy)).resolves.toBe("busy");
    expect(busy.setDraftText).not.toHaveBeenCalled();
    const missing = dependencies("task", { ...workspace, availability: "missing" } as WorkspaceDescriptor);
    await expect(startTeamWork({ workspaceId: "w1", teamScope: scope, text: "x" }, missing)).resolves.toBe("unavailable");
    expect(missing.showWork).not.toHaveBeenCalled();
    const gone = { ...dependencies("t"), workspace: vi.fn(() => undefined) };
    await expect(startTeamWork({ workspaceId: "gone", teamScope: scope, text: "x" }, gone)).resolves.toBe("unavailable");
  });

  it("builds briefs and hand-off references", () => {
    expect(chatMessageWorkBrief({ conversationLabel: "#宏观研究", senderName: "王一凡", body: " 看一下估值 \n" }))
      .toBe("来自 #宏观研究 的讨论（王一凡）：\n\n看一下估值");
    expect(handoffReferences({ workspaceName: " app ", branchName: "fix/x", link: "https://github.com/a/b/pull/12" })).toEqual([
      { kind: "repository", label: "app" },
      { kind: "branch", label: "fix/x" },
      { kind: "pull_request", label: "https://github.com/a/b/pull/12", url: "https://github.com/a/b/pull/12" }
    ]);
    expect(handoffReferences({ link: "https://docs.example.test/spec" })).toEqual([
      { kind: "link", label: "https://docs.example.test/spec", url: "https://docs.example.test/spec" }
    ]);
    expect(handoffReferences({ workspaceName: " ", branchName: "", link: " " })).toEqual([]);
  });

  it("accepts only credential-free HTTPS links", () => {
    expect(isHandoffLink("")).toBe(true);
    expect(isHandoffLink("https://github.com/a/b/pull/1")).toBe(true);
    expect(isHandoffLink("http://example.test")).toBe(false);
    expect(isHandoffLink("https://user:pass@example.test")).toBe(false);
    expect(isHandoffLink("not a url")).toBe(false);
  });

  it("reads the current attached branch only from a fresh ready snapshot", () => {
    const snapshot = (patch: Partial<RepositoryEnvironmentSnapshot>, detached = false): RepositoryEnvironmentSnapshot => ({
      workspaceId: "w1", status: "ready", revision: 1, observedAt: 0, stale: false,
      repository: { repositoryGroupId: "g", assurance: "filesystem", currentWorktreeId: "wt2" },
      worktrees: [
        { worktreeId: "wt1", kind: "primary", status: "ready", branchName: "main", detached: false, locked: false },
        { worktreeId: "wt2", kind: "linked", status: "ready", branchName: "fix/chat", detached, locked: false }
      ],
      ...patch
    } as RepositoryEnvironmentSnapshot);
    expect(currentBranchName(snapshot({}))).toBe("fix/chat");
    expect(currentBranchName(snapshot({}, true))).toBeUndefined();
    expect(currentBranchName(snapshot({ stale: true }))).toBeUndefined();
    expect(currentBranchName(snapshot({ status: "non-git" } as Partial<RepositoryEnvironmentSnapshot>))).toBeUndefined();
    expect(currentBranchName(undefined)).toBeUndefined();
  });
});
