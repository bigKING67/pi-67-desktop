export async function assertPackagedSkillSuites(skillSettingsWorkspace, captureScreenshot) {
  const bundledSkillPanel = skillSettingsWorkspace.getByRole("tabpanel", { name: "全局可用", exact: true });
  const bundledRows = bundledSkillPanel.getByTestId("bundled-skill-suite-row");
  await bundledRows.filter({ hasText: "飞书 Lark CLI" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await bundledRows.filter({ hasText: "Commerce Growth OS" })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await bundledRows.getByText("packaged-skill", { exact: true }).count()) {
    throw new Error("Packaged user Skill was duplicated in the bundled Skill view.");
  }
  if (await bundledRows.getByText("design-craft", { exact: true }).count()) {
    throw new Error("Packaged bundled Skill summary flattened individual Skill entries.");
  }
  await bundledSkillPanel.getByText("21 个技能 · 内置基线 1.0.1", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await captureScreenshot("07-bundled-skill-suites.png");
  await bundledSkillPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "AI Berkshire 投资研究" }).click();
  const suiteDetail = bundledSkillPanel.getByTestId("bundled-skill-suite-detail");
  await suiteDetail.getByText("1.0.1", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await suiteDetail.getByText("https://github.com/xbtlin/ai-berkshire", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await suiteDetail.getByText("66e556262", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await captureScreenshot("07-ai-berkshire-skill-suite-detail.png");
  await suiteDetail.getByRole("button", { name: "返回全局可用技能" }).click();
  await bundledSkillPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "Commerce Growth OS" }).click();
  await suiteDetail.getByText("commerce-growth-os", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await suiteDetail.getByText("commerce-analytics", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await suiteDetail.getByText("全局可用", { exact: true }).count() !== 1) {
    throw new Error("Packaged bundled Skill detail repeated suite readiness on individual Skills.");
  }
  await captureScreenshot("07-bundled-skill-suite-detail.png");
}
