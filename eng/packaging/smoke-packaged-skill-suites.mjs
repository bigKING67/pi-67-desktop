export async function assertPackagedSkillSuites(skillSettingsWorkspace, captureScreenshot) {
  await skillSettingsWorkspace.getByRole("tab", { name: "内置技能", exact: true }).click();
  const bundledSkillPanel = skillSettingsWorkspace.getByRole("tabpanel", { name: "内置技能", exact: true });
  await bundledSkillPanel.getByText("飞书 Lark CLI", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await bundledSkillPanel.getByText("Commerce Growth OS", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await bundledSkillPanel.getByText("packaged-skill", { exact: true }).count()) {
    throw new Error("Packaged user Skill was duplicated in the bundled Skill view.");
  }
  if (await bundledSkillPanel.getByText("design-craft", { exact: true }).count()) {
    throw new Error("Packaged bundled Skill summary flattened individual Skill entries.");
  }
  await captureScreenshot("07-bundled-skill-suites.png");
  await bundledSkillPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "Commerce Growth OS" }).click();
  const suiteDetail = bundledSkillPanel.getByTestId("bundled-skill-suite-detail");
  await suiteDetail.getByText("commerce-growth-os", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await suiteDetail.getByText("commerce-analytics", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await suiteDetail.getByText("已提供", { exact: true }).count() !== 1) {
    throw new Error("Packaged bundled Skill detail repeated suite readiness on individual Skills.");
  }
  await captureScreenshot("07-bundled-skill-suite-detail.png");
}
