import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposerRuntimeSelectOptions } from "./ComposerRuntimeSelect.js";

describe("ComposerRuntimeSelect Provider sections", () => {
  it("preserves the ungrouped empty-catalog recovery option", () => {
    const markup = renderToStaticMarkup(createElement(ComposerRuntimeSelectOptions, {
      optionGroups: [],
      options: [{ id: "__configure_provider__", label: "No models", detail: "Configure a Provider" }],
      variant: "model"
    }));

    expect(markup).not.toContain('role="group"');
    expect(markup).toContain('role="option"');
    expect(markup).toContain("No models");
    expect(markup).toContain("Configure a Provider");
  });

  it("renders counted non-option sections while preserving duplicate model labels and full details", () => {
    const markup = renderToStaticMarkup(createElement(ComposerRuntimeSelectOptions, {
      optionGroups: [{
        id: "groland",
        label: "Groland",
        options: [
          { id: "groland/claude-sonnet", label: "Sonnet", detail: "groland/claude-sonnet" },
          { id: "groland/gpt-5.6", label: "Sonnet", detail: "groland/gpt-5.6" }
        ]
      }],
      options: [],
      variant: "model"
    }));

    expect(markup).toContain('role="group"');
    expect(markup).toContain("Groland");
    expect(markup).toContain('aria-label="2 个模型"');
    expect(markup.match(/role="option"/gu)).toHaveLength(2);
    expect(markup).toContain("groland/claude-sonnet");
    expect(markup).toContain("groland/gpt-5.6");
  });
});
