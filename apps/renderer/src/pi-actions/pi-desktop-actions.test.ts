import { afterEach, describe, expect, it, vi } from "vitest";

const controllers = vi.hoisted(() => ({
  compact: vi.fn(async () => undefined),
  create: vi.fn(async () => undefined),
  reload: vi.fn(async () => undefined),
  selectModel: vi.fn(async () => undefined)
}));

vi.mock("../operation/operation-controller.js", () => ({
  compactRendererSession: controllers.compact
}));
vi.mock("../session/session-control-controller.js", () => ({
  reloadSessionResources: controllers.reload,
  selectSessionModel: controllers.selectModel
}));
vi.mock("../session/session-lifecycle-controller.js", () => ({
  createRendererSession: controllers.create
}));

import { useShellStore } from "../shell/shell-store.js";
import {
  executePiDesktopAction,
  piDesktopAction,
  piDesktopActionUnavailableReason,
  type PiDesktopActionContext
} from "./pi-desktop-actions.js";

const READY_CONTEXT: PiDesktopActionContext = {
  connected: true,
  workspaceAvailable: true,
  sessionReady: true,
  sessionTransitionPending: false,
  activeOperation: false,
  configuredModels: [{ provider: "openai", id: "gpt", configured: true }]
};

afterEach(() => {
  vi.clearAllMocks();
  useShellStore.setState(useShellStore.getInitialState(), true);
});

describe("Pi Desktop actions", () => {
  it("maps native actions to existing Renderer Controllers", async () => {
    await executePiDesktopAction(piDesktopAction("new")!, "", READY_CONTEXT);
    await executePiDesktopAction(piDesktopAction("compact")!, "keep decisions", READY_CONTEXT);
    await executePiDesktopAction(piDesktopAction("reload")!, "", READY_CONTEXT);
    await executePiDesktopAction(piDesktopAction("model")!, "openai/gpt", READY_CONTEXT);

    expect(controllers.create).toHaveBeenCalledOnce();
    expect(controllers.compact).toHaveBeenCalledWith("keep decisions");
    expect(controllers.reload).toHaveBeenCalledOnce();
    expect(controllers.selectModel).toHaveBeenCalledWith("openai", "gpt");
  });

  it("opens native model and Session Catalog controls without invoking the Runtime command path", async () => {
    await executePiDesktopAction(piDesktopAction("model")!, "", READY_CONTEXT);
    await executePiDesktopAction(piDesktopAction("resume")!, "", READY_CONTEXT);

    expect(useShellStore.getState()).toMatchObject({
      navigationVisible: true,
      sessionSearchFocusRevision: 1,
      modelPickerRequestRevision: 1
    });
  });

  it("keeps running and transition restrictions explicit", () => {
    expect(piDesktopActionUnavailableReason(
      piDesktopAction("compact")!,
      { ...READY_CONTEXT, activeOperation: true }
    )).toBe("当前任务结束或停止后可用。");
    expect(piDesktopActionUnavailableReason(
      piDesktopAction("new")!,
      { ...READY_CONTEXT, sessionTransitionPending: true }
    )).toBe("正在切换会话，请稍候。");
  });

  it("rejects unexpected arguments before any Controller runs", async () => {
    const result = await executePiDesktopAction(piDesktopAction("reload")!, "now", READY_CONTEXT);
    expect(result).toEqual({ status: "blocked", message: "/reload 不接受附加参数。" });
    expect(controllers.reload).not.toHaveBeenCalled();
  });
});
