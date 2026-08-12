import { describe, expect, it, vi } from "vitest";
import {
  startControlledPrompt,
  submitControlledPromptInput
} from "./controlled-provider-interaction.mjs";
import {
  CONTROLLED_MODEL_LABEL,
  CONTROLLED_PROMPT_TEXT
} from "./controlled-shutdown-fixture.ts";

describe("controlled Provider interaction", () => {
  it("keeps the established Session path gated on the controlled model", async () => {
    const actions = [];
    const modelText = {
      waitFor: vi.fn(async ({ state, timeout }) => actions.push(`model:${state}:${timeout}`))
    };
    const modelButton = {
      getByText: vi.fn((label, options) => {
        expect(label).toBe(CONTROLLED_MODEL_LABEL);
        expect(options).toEqual({ exact: true });
        return modelText;
      })
    };
    const sendButton = {
      click: vi.fn(async () => actions.push("send"))
    };
    const stopButton = {
      waitFor: vi.fn(async ({ state, timeout }) => actions.push(`stop:${state}:${timeout}`))
    };
    const composer = {
      fill: vi.fn(async (text) => actions.push(`fill:${text}`))
    };
    const composerShell = {
      getByRole: vi.fn((_role, options) => {
        expect(options).toEqual({ name: "停止", exact: true });
        return stopButton;
      })
    };
    const page = {
      getByLabel: vi.fn(() => composer),
      getByTestId: vi.fn((testId) => {
        expect(testId).toBe("composer-shell");
        return composerShell;
      }),
      getByRole: vi.fn((_role, options) => {
        if (options.name === "Pi 模型") return modelButton;
        if (options.name === "发送") return sendButton;
        throw new Error(`Unexpected role: ${String(options.name)}`);
      })
    };

    await startControlledPrompt(page);

    expect(actions).toEqual([
      "model:visible:30000",
      `fill:${CONTROLLED_PROMPT_TEXT}`,
      "send",
      "stop:visible:10000"
    ]);
  });

  it("submits a transactional first Prompt before Session-scoped models exist", async () => {
    const composer = { fill: vi.fn() };
    const sendButton = { click: vi.fn() };
    const page = {
      getByLabel: vi.fn(() => composer),
      getByRole: vi.fn((_role, options) => {
        expect(options.name).toBe("发送");
        return sendButton;
      })
    };

    await submitControlledPromptInput(page);

    expect(composer.fill).toHaveBeenCalledWith(CONTROLLED_PROMPT_TEXT);
    expect(sendButton.click).toHaveBeenCalledOnce();
  });
});
