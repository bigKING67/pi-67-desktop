import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openRendererSession: vi.fn(),
  publishNotification: vi.fn(),
  request: vi.fn(),
  requestTranscriptMessageJump: vi.fn(),
  selectedWorkbenchTask: vi.fn(),
  workbenchProtocolContextForTask: vi.fn()
}));

vi.mock("../session/session-lifecycle-controller.js", () => ({
  openRendererSession: mocks.openRendererSession
}));
vi.mock("../notifications/notification-store.js", () => ({
  publishNotification: mocks.publishNotification
}));
vi.mock("../connection/AgentConnectionController.js", () => ({
  agentConnectionController: { request: mocks.request }
}));
vi.mock("../transcript/transcript-navigation.js", () => ({
  requestTranscriptMessageJump: mocks.requestTranscriptMessageJump
}));
vi.mock("../workbench/workbench-store.js", () => ({
  rendererWorkbenchStore: { getState: vi.fn(() => ({ marker: "state" })) },
  selectedWorkbenchTask: mocks.selectedWorkbenchTask
}));
vi.mock("../workbench/workbench-protocol-context.js", () => ({
  workbenchProtocolContextForTask: mocks.workbenchProtocolContextForTask
}));

import { openWorkspaceMessageResult } from "./palette-message-result.js";

describe("palette message result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it("reports an exact Session opening failure without attempting message location", async () => {
    mocks.openRendererSession.mockRejectedValueOnce(new Error("Session identity is stale."));
    await openWorkspaceMessageResult({
      sessionPath: "/opaque/session-a.jsonl",
      sessionFileIdentity: "identity-a",
      sessionName: "对话 A",
      messageId: "message-a",
      role: "assistant",
      snippet: "matching text"
    });

    expect(mocks.openRendererSession).toHaveBeenCalledWith(
      "/opaque/session-a.jsonl",
      "identity-a"
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.requestTranscriptMessageJump).not.toHaveBeenCalled();
    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "warning",
      title: "无法打开对话正文结果",
      message: "Session identity is stale."
    });
  });

  it.each([
    [undefined, "目标对话未能完成权威绑定，请重试。"],
    [{ conversation: { kind: "provisional" } }, "目标对话未能完成权威绑定，请重试。"],
    [
      { conversation: { kind: "session", sessionFileIdentity: "identity-b" } },
      "目标对话未能完成权威绑定，请重试。"
    ]
  ])("rejects a Task without the exact opened Session authority", async (task, message) => {
    mocks.selectedWorkbenchTask.mockReturnValueOnce(task);

    await openWorkspaceMessageResult(messageItem());

    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "warning",
      title: "无法打开对话正文结果",
      message
    });
  });

  it("rejects a locate result from an obsolete Session instance", async () => {
    const task = sessionTask();
    mocks.selectedWorkbenchTask.mockReturnValueOnce(task);
    mocks.workbenchProtocolContextForTask.mockReturnValueOnce({ taskId: "task-a" });
    mocks.request.mockResolvedValueOnce({ sessionId: "session-obsolete" });

    await openWorkspaceMessageResult(messageItem());

    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "warning",
      title: "无法打开对话正文结果",
      message: "目标消息属于已失效的对话实例。"
    });
    expect(mocks.requestTranscriptMessageJump).not.toHaveBeenCalled();
  });

  it("locates and schedules focus for an exact Session message", async () => {
    const task = sessionTask();
    const locatedWindow = { sessionId: "session-a", messages: [] };
    mocks.selectedWorkbenchTask.mockReturnValueOnce(task);
    mocks.workbenchProtocolContextForTask.mockReturnValueOnce({ taskId: "task-a" });
    mocks.request.mockResolvedValueOnce(locatedWindow);

    await openWorkspaceMessageResult(messageItem());

    expect(mocks.request).toHaveBeenCalledWith(
      "message.locate",
      { id: "message-a" },
      [],
      { context: { taskId: "task-a" } }
    );
    expect(mocks.requestTranscriptMessageJump).toHaveBeenCalledWith({
      id: "message-a",
      window: locatedWindow
    });
    expect(mocks.publishNotification).not.toHaveBeenCalled();
  });

  it("uses the bounded fallback for a non-Error failure", async () => {
    mocks.openRendererSession.mockRejectedValueOnce("unavailable");

    await openWorkspaceMessageResult(messageItem());

    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "warning",
      title: "无法打开对话正文结果",
      message: "目标消息暂时不可用。"
    });
  });
});

function messageItem() {
  return {
    sessionPath: "/opaque/session-a.jsonl",
    sessionFileIdentity: "identity-a",
    sessionName: "对话 A",
    messageId: "message-a",
    role: "assistant" as const,
    snippet: "matching text"
  };
}

function sessionTask() {
  return {
    id: "task-a",
    sessionId: "session-a",
    conversation: { kind: "session", sessionFileIdentity: "identity-a" }
  };
}
