import { describe, expect, it, vi } from "vitest";
import { verifyPackagedChangesInspector } from "./packaged-changes-inspector-smoke.mjs";

describe("packaged Changes Inspector smoke", () => {
  it("restores a closed Inspector after verifying its empty state", async () => {
    const fixture = inspectorFixture(false);

    await verifyPackagedChangesInspector(fixture.window, fixture.captureScreenshot);

    expect(fixture.actions).toEqual([
      "show",
      "inspector:visible",
      "tab:changes",
      "text:summary:visible",
      "text:authority:visible",
      "text:empty:visible",
      "screenshot:01-changes-empty.png",
      "hide",
      "inspector:hidden"
    ]);
  });

  it("preserves an Inspector that was already open", async () => {
    const fixture = inspectorFixture(true);

    await verifyPackagedChangesInspector(fixture.window, fixture.captureScreenshot);

    expect(fixture.actions).toEqual([
      "inspector:visible",
      "tab:changes",
      "text:summary:visible",
      "text:authority:visible",
      "text:empty:visible",
      "screenshot:01-changes-empty.png"
    ]);
  });
  it("reports only bounded state flags and preserves the original failure", async () => {
    const cause = new Error("original timeout");
    const fixture = inspectorFixture(true, cause);
    const error = await verifyPackagedChangesInspector(fixture.window, fixture.captureScreenshot).catch((error) => error);
    expect(error.cause).toBe(cause);
    const state = JSON.parse(error.message.split(": ").slice(1).join(": "));
    expect(state).toMatchObject({ inspectorVisible: true, missingAuthorityVisible: true, runtimeReadyVisible: true });
    expect(Object.values(state).every((value) => typeof value === "boolean" || value === null)).toBe(true);
    expect(fixture.captureScreenshot).not.toHaveBeenCalled();
  });

  it("bounds diagnostic collection when the page stops responding", async () => {
    vi.useFakeTimers();
    try {
      const cause = new Error("original timeout");
      const fixture = inspectorFixture(true, cause);
      fixture.window.locator = () => ({ isVisible: () => new Promise(() => undefined) });
      const result = verifyPackagedChangesInspector(fixture.window, fixture.captureScreenshot).catch((error) => error);
      await vi.advanceTimersByTimeAsync(1_500);
      const error = await result;
      expect(error.cause).toBe(cause);
      expect(error.message).toContain('"reason":"diagnostic-timeout"');
    } finally {
      vi.useRealTimers();
    }
  });

});

function inspectorFixture(initiallyVisible, failure) {
  const actions = [];
  let visible = initiallyVisible;
  const inspector = {
    getByRole: vi.fn((_role, options) => ({
      click: async () => actions.push(`tab:${options.name === "修改" ? "changes" : options.name}`),
      isVisible: async () => true
    })),
    getByText: vi.fn((text) => ({
      waitFor: async ({ state }) => {
        if (failure) throw failure;
        actions.push(`text:${textLabel(text)}:${state}`);
      },
      isVisible: async () => text.startsWith("打开一个运行中的会话")
    })),
    isVisible: vi.fn(async () => visible),
    waitFor: vi.fn(async ({ state }) => {
      expect(visible).toBe(state === "visible");
      actions.push(`inspector:${state}`);
    })
  };
  const show = {
    click: vi.fn(async () => {
      visible = true;
      actions.push("show");
    })
  };
  const hide = {
    click: vi.fn(async () => {
      visible = false;
      actions.push("hide");
    })
  };
  const window = {
    locator: () => ({ isVisible: async () => true }),
    getByRole: vi.fn((role, options) => {
      if (role === "complementary") return inspector;
      if (options.name === "显示任务检查器") return show;
      if (options.name === "隐藏任务检查器") return hide;
      throw new Error(`Unexpected role lookup: ${role}/${String(options.name)}`);
    })
  };
  const captureScreenshot = vi.fn(async (_window, fileName) => {
    expect(visible).toBe(true);
    actions.push(`screenshot:${fileName}`);
  });
  return { actions, captureScreenshot, window };
}

function textLabel(text) {
  if (text === "0 个文件 · 0 条记录") return "summary";
  if (text === "Pi Session 修改投影，不等于当前 Git 或完整 Workspace Diff。") return "authority";
  if (text === "当前活动分支还没有 edit 或 write 修改记录。") return "empty";
  throw new Error(`Unexpected Inspector text: ${text}`);
}
