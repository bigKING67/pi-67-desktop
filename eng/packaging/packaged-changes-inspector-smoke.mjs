export async function assertNoWorkspaceChangesAuthorityWarning(window) {
  if (await window.getByText("无法加载本会话修改记录", { exact: true }).count()) {
    throw new Error("Packaged workspace-only Settings requested Task-scoped workspace changes.");
  }
}

export async function verifyPackagedChangesInspector(window, captureScreenshot) {
  try {
    await verifyChangesInspector(window, captureScreenshot);
  } catch (cause) {
    const state = await inspectChangesFailure(window);
    throw new Error(`Packaged Changes Inspector verification failed: ${JSON.stringify(state)}`, { cause });
  }
}

async function inspectChangesFailure(window) {
  let timer;
  try {
    const inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
    const probes = {
      inspectorVisible: () => inspector.isVisible(),
      changesTabSelected: () => inspector.getByRole("tab", { name: "修改", exact: true, selected: true }).isVisible(),
      sessionTabSelected: () => inspector.getByRole("tab", { name: "会话修改", exact: true, selected: true }).isVisible(),
      emptySummaryVisible: () => inspector.getByText("0 个文件 · 0 条记录", { exact: true }).isVisible(),
      missingAuthorityVisible: () => inspector.getByText("打开一个运行中的会话后，可查看当前活动分支的修改记录。", { exact: true }).isVisible(),
      loadingVisible: () => inspector.getByText("正在读取本会话修改记录。", { exact: true }).isVisible(),
      loadErrorVisible: () => inspector.getByText("修改记录暂时不可用；对话和其他检查器功能不受影响。", { exact: true }).isVisible(),
      runtimeReadyVisible: () => window.locator('[data-runtime-phase="ready"]').isVisible()
    };
    return await Promise.race([
      Promise.all(Object.entries(probes).map(async ([key, probe]) => {
        try { return [key, await probe()]; } catch { return [key, null]; }
      })).then(Object.fromEntries),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ unavailable: true, reason: "diagnostic-timeout" }), 1_500);
      })
    ]);
  } catch {
    return { unavailable: true, reason: "diagnostic-unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function verifyChangesInspector(window, captureScreenshot) {
  let inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
  const restoreClosedState = !(await inspector.isVisible());
  if (restoreClosedState) {
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
  if (restoreClosedState) {
    await window.getByRole("button", { name: "隐藏任务检查器", exact: true }).click();
    await inspector.waitFor({ state: "hidden", timeout: 15_000 });
  }
}
