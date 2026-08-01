import {
  CONTROLLED_MODEL_LABEL,
  CONTROLLED_PROMPT_TEXT
} from "./controlled-shutdown-fixture.ts";

export async function startControlledPrompt(page) {
  await page.getByRole("button", { name: "Pi 模型", exact: true })
    .getByText(CONTROLLED_MODEL_LABEL, { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.getByLabel("给 Pi 发送消息").fill(CONTROLLED_PROMPT_TEXT);
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "停止" }).waitFor({ state: "visible", timeout: 10_000 });
}
