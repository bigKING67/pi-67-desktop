import {
  CONTROLLED_MODEL_VALUE,
  CONTROLLED_PROMPT_TEXT
} from "./controlled-shutdown-fixture.ts";

export async function startControlledPrompt(page) {
  await page.waitForFunction((expected) => (
    document.querySelector('select[aria-label="Pi 模型"]')?.value === expected
  ), CONTROLLED_MODEL_VALUE);
  await page.getByLabel("给 Pi 发送消息").fill(CONTROLLED_PROMPT_TEXT);
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "停止" }).waitFor({ state: "visible", timeout: 10_000 });
}
