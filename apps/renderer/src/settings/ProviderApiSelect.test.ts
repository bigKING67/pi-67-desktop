import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  apiFromSelectionKey,
  apiValueLabel,
  PI_MODELS_JSON_API_OPTIONS,
  ProviderApiSelectOptions
} from "./ProviderApiSelect.js";

describe("Provider API selection", () => {
  it("exposes the four API protocols supported by Pi models.json, including Gemini", () => {
    expect(PI_MODELS_JSON_API_OPTIONS.map((option) => option.id)).toEqual([
      "openai-responses",
      "openai-completions",
      "anthropic-messages",
      "google-generative-ai"
    ]);

    const markup = renderToStaticMarkup(createElement(ProviderApiSelectOptions, {
      currentValue: "google-generative-ai",
      unsetDetail: "Use the Provider default",
      unsetLabel: "Inherit"
    }));

    expect(markup.match(/role="group"/gu)).toHaveLength(2);
    expect(markup.match(/role="option"/gu)).toHaveLength(5);
    expect(markup).toContain("Google Gemini");
    expect(markup).toContain("google-generative-ai");
    expect(markup).not.toContain("anthropic-responses");
  });

  it("preserves an existing extension-registered API as a separate current-value section", () => {
    const markup = renderToStaticMarkup(createElement(ProviderApiSelectOptions, {
      currentValue: "company-stream-v2",
      unsetDetail: "Specify per model",
      unsetLabel: "Per model"
    }));

    expect(markup.match(/role="group"/gu)).toHaveLength(3);
    expect(markup).toContain("当前配置");
    expect(markup).toContain("company-stream-v2");
    expect(apiValueLabel("company-stream-v2", "Unset")).toBe("自定义协议 · company-stream-v2");
    expect(apiFromSelectionKey("api:company-stream-v2")).toBe("company-stream-v2");
  });

  it("maps the explicit resolution option back to an omitted API override", () => {
    expect(apiFromSelectionKey("resolution:unset")).toBeUndefined();
    expect(apiValueLabel(undefined, "继承 Provider 默认")).toBe("继承 Provider 默认");
  });
});
