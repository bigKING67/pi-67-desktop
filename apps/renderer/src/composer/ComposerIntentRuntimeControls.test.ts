import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { useShellStore } from "../shell/shell-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { ComposerIntentRuntimeControls } from "./ComposerIntentRuntimeControls.js";

describe("ComposerIntentRuntimeControls", () => {
  afterEach(() => {
    useTaskDraftStore.getState().dispose();
    useShellStore.setState(useShellStore.getInitialState(), true);
  });

  it("keeps runtime controls visible before a Pi Session exists", () => {
    const markup = renderToStaticMarkup(createElement(ComposerIntentRuntimeControls, {
      taskId: "intent-1",
      workspaceId: "workspace-1",
      submitting: false
    }));

    expect(markup).toContain("本次发送设置");
    expect(markup).toContain("正在读取模型");
    expect(markup).toContain("思考：默认");
  });
});
