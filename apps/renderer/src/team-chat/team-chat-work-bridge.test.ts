import type { RepositoryEnvironmentSnapshot, WorkspaceDescriptor } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import { chatMessageWorkBrief, currentBranchName, deliverHandoff, handOff, handoffReferences, handoffTarget, isHandoffLink, startTeamWork } from "./team-chat-work-bridge.js";

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

  it("hands off pictures: uploads them with their sizes, sends the card assigned in a direct message, then one message with them", async () => {
    const calls: { type: string; payload: Record<string, unknown> }[] = [];
    const request = vi.fn(async (type: string, payload: Record<string, unknown>) => {
      calls.push({ type, payload });
      if (type === "teamChat.attachment.begin") return { attachment: { id: `a-${String(payload.fileName)}`, fileName: payload.fileName, contentType: "image/png", byteSize: payload.byteSize } };
      if (type === "teamChat.attachment.chunk") return { received: (payload.offset as number) + (payload.data as ArrayBuffer).byteLength };
      if (type === "teamChat.attachment.finish") return { attachment: { id: payload.attachmentId, fileName: "f.png", contentType: "image/png", byteSize: 4 } };
      return {};
    });
    const chat = { ensureDirectMessage: vi.fn(async () => "dm-1"), createWorkCard: vi.fn(async () => undefined), send: vi.fn(async () => true) };
    const card = { title: "春日茶礼", goal: "上架", acceptance: "三张图", summary: "", refs: [] };
    const pictures = [{ file: new File([new Uint8Array(4)], "a.png"), size: { width: 1080, height: 1920 } }, { file: new File([new Uint8Array(4)], "b.png") }];
    const input = { card, pictures, imagesMessage: "春日茶礼 · 交付图片", picturesFailed: "图片没有发出" };
    await deliverHandoff(chat as never, request as never, { ...input, target: "dm:u2" });
    expect(chat.createWorkCard).toHaveBeenCalledWith("dm-1", { ...card, assigneeUserId: "u2" });
    expect(chat.send).toHaveBeenCalledWith("dm-1", "春日茶礼 · 交付图片", [], [expect.objectContaining({ id: "a-a.png" }), expect.objectContaining({ id: "a-b.png" })]);
    expect(calls.find((call) => call.type === "teamChat.attachment.begin")?.payload).toMatchObject({ fileName: "a.png", width: 1080, height: 1920 });

    // A card that fails leaves no uploaded pictures behind, and no picture message follows.
    chat.createWorkCard.mockRejectedValueOnce(new Error("stale"));
    chat.send.mockClear(); calls.length = 0;
    await expect(deliverHandoff(chat as never, request as never, { ...input, target: "conversation:c1" })).rejects.toThrow("stale");
    expect(calls.filter((call) => call.type === "teamChat.attachment.discard")).toHaveLength(2);
    expect(chat.send).not.toHaveBeenCalled();
    // A picture message that fails (left to retry in the conversation) is reported, not hidden.
    chat.send.mockResolvedValueOnce(false);
    await expect(deliverHandoff(chat as never, request as never, { ...input, target: "conversation:c1" })).rejects.toThrow("图片没有发出");
    // Without pictures it is a plain card.
    chat.createWorkCard.mockClear(); chat.send.mockClear();
    await deliverHandoff(chat as never, request as never, { ...input, pictures: [], target: "conversation:c1" });
    expect(chat.createWorkCard).toHaveBeenCalledWith("c1", card);
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("sends nothing when the pictures are stopped at their check", async () => {
    const deliver = vi.fn(async () => undefined);
    expect(await handOff({ prepare: async () => undefined }, deliver)).toBe("stopped");
    expect(deliver).not.toHaveBeenCalled();
    expect(await handOff(undefined, deliver)).toBe("sent");
    expect(deliver).toHaveBeenCalledWith([]);
    expect(handoffTarget("dm:u2")).toEqual({ kind: "dm", id: "u2" });
    expect(handoffTarget("conversation:c1")).toEqual({ kind: "conversation", id: "c1" });
  });
});
