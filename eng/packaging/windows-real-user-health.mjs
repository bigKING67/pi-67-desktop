export async function assertHealthyWorkbench(window) {
  const observation = await window.evaluate(() => {
    const bodyText = document.body.innerText;
    const rows = [...document.querySelectorAll('[data-testid="conversation-row"]')];
    return {
      ghostCount: rows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("provisional:"))
        .length,
      rawAcknowledgementTimeout: bodyText.includes("Agent request acknowledgement timed out"),
      rawEnoent: /ENOENT|no such file or directory/iu.test(bodyText),
      runningCount: rows.filter((row) => row.textContent?.includes("运行中")).length
    };
  });
  if (observation.ghostCount > 0) throw new Error("Windows real-user lifecycle exposed a provisional ghost Session.");
  if (observation.rawAcknowledgementTimeout) throw new Error("Windows real-user lifecycle exposed a raw acknowledgement timeout.");
  if (observation.rawEnoent) throw new Error("Windows real-user lifecycle exposed a raw ENOENT error.");
  if (observation.runningCount > 0) throw new Error("Windows real-user lifecycle exposed a false running Session.");
}

export async function assertNoFailureNotifications(window) {
  await window.getByRole("button", { name: /打开通知中心/u }).click({ timeout: 10_000 });
  const dialog = window.getByRole("dialog", { name: "通知中心" });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const text = (await dialog.textContent()) ?? "";
  if (/Agent request acknowledgement timed out|ENOENT|no such file or directory/iu.test(text)) {
    throw new Error("Windows real-user notification history exposed a raw transport or ENOENT error.");
  }
  if (text.includes("无法读取 Pi Provider 配置")) {
    throw new Error("Windows real-user notification history contains a Provider configuration failure.");
  }
  await window.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}

export async function verifyGitMetadataIsHidden(window) {
  let inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
  const openedByProbe = !(await inspector.isVisible());
  if (openedByProbe) {
    await window.getByRole("button", { name: "显示任务检查器", exact: true }).click({ timeout: 10_000 });
    inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
  }
  try {
    await inspector.waitFor({ state: "visible", timeout: 10_000 });
    await inspector.getByRole("tab", { name: "文件", exact: true }).click({ timeout: 10_000 });
    await inspector.locator(".inspector-file-name").getByText("README.md", { exact: true })
      .waitFor({ state: "visible", timeout: 10_000 });
    const rootNames = await inspector.locator(".inspector-file-name").allTextContents();
    if (rootNames.includes(".git")) throw new Error("Windows real-user file projection exposed .git metadata.");

    const search = inspector.getByRole("textbox", { name: "搜索工作区文件" });
    await search.fill(".git");
    await search.press("Enter");
    await inspector.getByText("没有匹配的文件。", { exact: true })
      .waitFor({ state: "visible", timeout: 10_000 });
    const searchNames = await inspector.locator(".inspector-file-name").allTextContents();
    if (searchNames.some((name) => name === ".git" || name.startsWith(".git/"))) {
      throw new Error("Windows real-user file search exposed .git metadata.");
    }
    await search.fill("");
    return { gitMetadataHidden: true, readmeVisible: true };
  } finally {
    if (openedByProbe) {
      await window.getByRole("button", { name: "隐藏任务检查器", exact: true }).click({ timeout: 10_000 });
      await inspector.waitFor({ state: "detached", timeout: 10_000 });
    }
  }
}
