import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openRendererSession: vi.fn(),
  publishNotification: vi.fn(),
  request: vi.fn(),
  requestTranscriptMessageJump: vi.fn()
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

import { openPaletteMessageResult } from "./palette-message-result.js";

describe("palette message result", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports an exact Session opening failure without attempting message location", async () => {
    mocks.openRendererSession.mockRejectedValueOnce(new Error("Session identity is stale."));
    await openPaletteMessageResult({
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
});
