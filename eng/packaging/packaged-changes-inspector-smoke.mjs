export async function assertNoWorkspaceChangesAuthorityWarning(window) {
  if (await window.getByText("无法加载本会话修改记录", { exact: true }).count()) {
    throw new Error("Packaged workspace-only Settings requested Task-scoped workspace changes.");
  }
}

export async function verifyPackagedChangesInspector(window, captureScreenshot) {
  let inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
  if (!(await inspector.isVisible())) {
    await window.getByRole("button", { name: "显示任务检查器", exact: true }).click();
    inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
  }
  await inspector.waitFor({ state: "visible", timeout: 15_000 });
  await inspector.getByRole("tab", { name: "修改", exact: true }).click();
  await inspector.getByText("0 个文件 · 0 条记录", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await inspector.getByText("Pi Session 修改投影，不等于当前 Git 或完整 Workspace Diff。", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await inspector.getByText("当前活动分支还没有 edit 或 write 修改记录。", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await captureScreenshot(window, "01-changes-empty.png");
}
