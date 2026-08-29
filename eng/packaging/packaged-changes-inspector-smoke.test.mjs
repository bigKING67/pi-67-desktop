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
});

function inspectorFixture(initiallyVisible) {
  const actions = [];
  let visible = initiallyVisible;
  const inspector = {
    getByRole: vi.fn((_role, options) => ({
      click: async () => actions.push(`tab:${options.name === "修改" ? "changes" : options.name}`)
    })),
    getByText: vi.fn((text) => ({
      waitFor: async ({ state }) => actions.push(`text:${textLabel(text)}:${state}`)
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
