import {
  CONTROLLED_MODEL_LABEL,
  CONTROLLED_PROMPT_TEXT
} from "./controlled-shutdown-fixture.ts";

export async function startControlledPrompt(page) {
  await submitControlledPrompt(page);
  await waitForControlledPromptRunning(page);
}

async function submitControlledPrompt(page, timeoutMs = 30_000) {
  await submitControlledPromptInput(page);
  await waitForControlledModel(page, timeoutMs);
}

export async function submitControlledPromptInput(page) {
  await page.getByLabel("给 Pi 发送消息").fill(CONTROLLED_PROMPT_TEXT);
  await page.getByRole("button", { name: "发送" }).click();
}

export async function waitForControlledModel(page, timeoutMs = 30_000) {
  try {
    await page.getByRole("button", { name: "Pi 模型", exact: true })
      .getByText(CONTROLLED_MODEL_LABEL, { exact: true })
      .waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      modelControl: document.querySelector('[aria-label="Pi 模型"]')?.textContent?.trim().slice(0, 240) ?? null,
      runtimeStatus: document.querySelector('[aria-label^="当前状态："]')?.getAttribute("aria-label") ?? null,
      selectedConversation: document.querySelector('[data-testid="conversation-row"][aria-current="page"]')
        ?.getAttribute("data-conversation-id") ?? null
    })).catch(() => ({ unavailable: true }));
    throw new Error(`Controlled model did not hydrate within ${timeoutMs}ms: ${JSON.stringify(diagnostics)}`, {
      cause: error
    });
  }
}

export async function waitForControlledPromptRunning(page, timeoutMs = 10_000) {
  await page.getByTestId("composer-shell").getByRole("button", { name: "停止", exact: true })
    .waitFor({ state: "visible", timeout: timeoutMs });
}
