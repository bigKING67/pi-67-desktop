import { describe, expect, it } from "vitest";
import { modelCapabilityView } from "./provider-model-capabilities.js";

describe("Provider model capability view", () => {
  it("shows Groland Claude and GPT as image, reasoning, and declared native-search models", () => {
    expect(modelCapabilityView("groland", {
      id: "claude-opus-4-8",
      api: "anthropic-messages",
      input: ["text", "image"],
      reasoning: true
    })).toEqual({
      protocol: "anthropic-messages",
      image: true,
      reasoning: true,
      search: "native-declared"
    });
    expect(modelCapabilityView("groland", {
      id: "gpt-5.5",
      api: "openai-responses",
      input: ["text", "image"],
      reasoning: true
    })).toMatchObject({
      protocol: "openai-responses",
      image: true,
      reasoning: true,
      search: "native-declared"
    });
  });

  it("distinguishes DeepSeek V4 Flash native search from V4 Pro Exa fallback", () => {
    expect(modelCapabilityView("deepseek", {
      id: "deepseek-v4-flash",
      input: ["text", "image"],
      reasoning: true
    }).search).toBe("native-declared");
    expect(modelCapabilityView("deepseek", {
      id: "deepseek-v4-pro",
      input: ["text", "image"],
      reasoning: true
    }).search).toBe("exa-fallback");
  });

  it("does not present declared capability as live verification", () => {
    expect(modelCapabilityView("openai", {
      id: "gpt-5.5",
      api: "openai-responses",
      input: ["text", "image"],
      reasoning: true
    }).search).toBe("native-declared");
  });

  it("does not overstate native search for custom or protocol-mismatched Groland models", () => {
    expect(modelCapabilityView("groland", {
      id: "custom-vision-model",
      api: "openai-responses",
      input: ["text", "image"],
      reasoning: true
    }).search).toBe("exa-fallback");
    expect(modelCapabilityView("groland", {
      id: "claude-opus-4-8",
      api: "openai-responses",
      input: ["text", "image"],
      reasoning: true
    }).search).toBe("exa-fallback");
  });
});
