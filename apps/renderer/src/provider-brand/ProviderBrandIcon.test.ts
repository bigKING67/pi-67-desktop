import { describe, expect, it } from "vitest";
import { resolveProviderBrand } from "./ProviderBrandIcon.js";

function brandOf(...hints: Array<string | undefined>) {
  return resolveProviderBrand(hints)?.src;
}

describe("resolveProviderBrand", () => {
  it("prefers specific identities over the families that contain them", () => {
    expect(brandOf("openai-codex")).toBe(brandOf("codex"));
    expect(brandOf("openai-codex")).not.toBe(brandOf("openai"));
    expect(brandOf("github-copilot")).not.toBe(brandOf("github"));
    expect(brandOf("doubao-seed-2-1-lite", "volcengine-ark")).not.toBe(brandOf("volcengine-ark"));
  });

  it("matches Provider IDs, display names and API hosts", () => {
    expect(brandOf("anthropic")).toBe(brandOf("claude-sonnet-5"));
    expect(brandOf("moonshotai-cn")).toBe(brandOf("Kimi"));
    expect(brandOf(undefined, "Zhipu GLM")).toBe(brandOf("open.bigmodel.cn"));
    expect(brandOf("custom", "My Gateway", "api.deepseek.com")).toBe(brandOf("deepseek"));
  });

  it("uses the first hint that resolves so a model brand wins over its Provider", () => {
    expect(brandOf("gpt-6.1-sol", "codex")).toBe(brandOf("openai"));
    expect(brandOf("unknown-model", "codex")).toBe(brandOf("codex"));
  });

  it("leaves unknown identities to the monogram fallback", () => {
    expect(resolveProviderBrand(["groland", "Groland", undefined])).toBeUndefined();
    expect(resolveProviderBrand([])).toBeUndefined();
  });

  it("marks single-color logos so they follow the theme text color", () => {
    expect(resolveProviderBrand(["openai"])?.mono).toBe(true);
    expect(resolveProviderBrand(["deepseek"])?.mono).toBeUndefined();
  });
});
