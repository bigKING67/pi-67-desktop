import { readFileSync } from "node:fs";

const capabilitySourcesLock = JSON.parse(
  readFileSync(new URL("../capabilities/capability-sources.lock.json", import.meta.url), "utf8")
);
const aiBerkshireSourceCommit = resolveSkillPackSourceCommit(
  capabilitySourcesLock,
  "ai-berkshire-investment-suite"
);

export function resolveSkillPackSourceCommit(lock, packName) {
  if (lock?.schema !== "pi67.capability-sources-lock.v1" || !Array.isArray(lock.skillPacks)) {
    throw new Error("Capability source lock does not contain a valid Skill Pack catalog.");
  }
  const matches = lock.skillPacks.filter((pack) => pack?.name === packName);
  if (matches.length !== 1 || !/^[0-9a-f]{40}$/u.test(matches[0]?.commit ?? "")) {
    throw new Error(`Capability source lock does not uniquely pin Skill Pack ${packName}.`);
  }
  return matches[0].commit;
}

export async function assertPackagedSkillSuites(skillSettingsWorkspace, captureScreenshot) {
  const bundledSkillPanel = skillSettingsWorkspace.getByRole("tabpanel", { name: "全局可用", exact: true });
  const bundledRows = bundledSkillPanel.getByTestId("bundled-skill-suite-row");
  await bundledRows.filter({ hasText: "飞书 Lark CLI" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await bundledRows.filter({ hasText: "Commerce Growth OS" })
    .waitFor({ state: "visible", timeout: 15_000 });
  const aiBerkshireRow = bundledRows.filter({ hasText: "AI Berkshire 投资研究" });
  await aiBerkshireRow.waitFor({ state: "visible", timeout: 15_000 });
  if (await bundledRows.getByText("packaged-skill", { exact: true }).count()) {
    throw new Error("Packaged user Skill was duplicated in the bundled Skill view.");
  }
  if (await bundledRows.getByText("design-craft", { exact: true }).count()) {
    throw new Error("Packaged bundled Skill summary flattened individual Skill entries.");
  }
  await aiBerkshireRow.getByText(/^21 个技能 · .*1\.0\.1/u)
    .waitFor({ state: "visible", timeout: 15_000 });
  await captureScreenshot("07-bundled-skill-suites.png");
  await bundledSkillPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "AI Berkshire 投资研究" }).click();
  const suiteDetail = bundledSkillPanel.getByTestId("bundled-skill-suite-detail");
  await suiteDetail.getByText("1.0.1", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await suiteDetail.getByText("https://github.com/xbtlin/ai-berkshire", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await suiteDetail.getByText(aiBerkshireSourceCommit.slice(0, 9), { exact: true })
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
