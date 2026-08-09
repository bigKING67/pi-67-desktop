import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  publishNotification: vi.fn(),
  currentAuthority: vi.fn(),
  acceptResponse: vi.fn(),
  capture: vi.fn(),
  clearQueue: vi.fn(),
  appGetState: vi.fn()
}));

vi.mock("../connection/AgentConnectionController.js", () => ({
  agentConnectionController: { request: mocks.request }
}));
vi.mock("../notifications/notification-store.js", () => ({
  publishNotification: mocks.publishNotification
}));
vi.mock("../session/session-authority.js", () => ({
  acceptRendererSessionResponse: mocks.acceptResponse,
  currentRendererSessionAuthority: mocks.currentAuthority
}));
vi.mock("../session/session-projection-store.js", () => ({
  useSessionProjectionStore: {
    getState: () => ({ capture: mocks.capture, clearQueue: mocks.clearQueue })
  }
}));
vi.mock("../app/app-store.js", () => ({
  useAppStore: { getState: mocks.appGetState }
}));

import { clearRendererQueue } from "./queue-controller.js";

describe("queue controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentAuthority.mockReturnValue({ sessionId: "session-a", sessionGeneration: 3 });
    mocks.capture.mockReturnValue({ sessionId: "session-a", revision: 4 });
    mocks.acceptResponse.mockReturnValue(true);
    mocks.request.mockResolvedValue({ cleared: 2 });
  });

  it("clears the captured projection after an accepted Pi response", async () => {
    await expect(clearRendererQueue()).resolves.toBe(true);

    expect(mocks.request).toHaveBeenCalledWith("queue.clear", {});
    expect(mocks.clearQueue).toHaveBeenCalledWith({ sessionId: "session-a", revision: 4 });
    expect(mocks.publishNotification).not.toHaveBeenCalled();
  });

  it("fails closed without current Session authority", async () => {
    mocks.currentAuthority.mockReturnValueOnce(undefined);

    await expect(clearRendererQueue()).resolves.toBe(false);

    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "error",
      title: "无法清空消息队列",
      message: "Pi 会话身份尚未就绪。"
    });
  });

  it("fails closed without a current Session projection", async () => {
    mocks.capture.mockReturnValueOnce(undefined);

    await expect(clearRendererQueue()).resolves.toBe(false);

    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "error",
      title: "无法清空消息队列",
      message: "Renderer Session projection is not current."
    });
  });

  it("does not mutate a projection after the Session authority changes", async () => {
    mocks.acceptResponse.mockReturnValueOnce(false);

    await expect(clearRendererQueue()).resolves.toBe(false);

    expect(mocks.clearQueue).not.toHaveBeenCalled();
    expect(mocks.publishNotification).not.toHaveBeenCalled();
  });

  it("reports an exact Pi request failure", async () => {
    mocks.request.mockRejectedValueOnce(new Error("host unavailable"));

    await expect(clearRendererQueue()).resolves.toBe(false);

    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "error",
      title: "无法清空消息队列",
      message: "host unavailable"
    });
  });

  it("uses the bounded fallback for a non-Error failure", async () => {
    mocks.request.mockRejectedValueOnce("offline");

    await expect(clearRendererQueue()).resolves.toBe(false);

    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "error",
      title: "无法清空消息队列",
      message: "未知错误"
    });
  });
});
