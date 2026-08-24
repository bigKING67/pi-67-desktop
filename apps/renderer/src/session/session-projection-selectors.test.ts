import type { ModelSummary, ProviderSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { groupVisibleSessionModelsByProvider } from "./session-projection-selectors.js";

const models: ModelSummary[] = [
  { provider: "openai", id: "gpt-5.6", label: "GPT-5.6", configured: true, reasoning: true },
  { provider: "groland", id: "claude-sonnet", label: "Sonnet", configured: true, reasoning: true },
  { provider: "groland", id: "gpt-5.6", label: "Sonnet", configured: true, reasoning: true },
  { provider: "missing", id: "recovery", label: "Recovery", configured: false, reasoning: false }
];

const providers: ProviderSummary[] = [
  { id: "groland", label: "Groland", configured: true, modelCount: 2 },
  { id: "openai", label: "OpenAI", configured: true, modelCount: 1 }
];

describe("groupVisibleSessionModelsByProvider", () => {
  it("returns no sections when neither a configured nor recovery model is visible", () => {
    expect(groupVisibleSessionModelsByProvider([
      { provider: "missing", id: "hidden", label: "Hidden", configured: false, reasoning: false }
    ], providers, undefined)).toEqual([]);
  });

  it("follows projected Provider order while preserving model order and mixed Groland membership", () => {
    const groups = groupVisibleSessionModelsByProvider(models, providers, { provider: "openai", id: "gpt-5.6" });

    expect(groups.map((group) => [group.id, group.label, group.models.map((model) => model.id)])).toEqual([
      ["groland", "Groland", ["claude-sonnet", "gpt-5.6"]],
      ["openai", "OpenAI", ["gpt-5.6"]]
    ]);
    expect(groups.flatMap((group) => group.models).map((model) => `${model.provider}/${model.id}`)).toEqual([
      "groland/claude-sonnet",
      "groland/gpt-5.6",
      "openai/gpt-5.6"
    ]);
  });

  it("keeps a selected unconfigured model in an ID-fallback section without moving any Provider", () => {
    const groups = groupVisibleSessionModelsByProvider(models, providers, { provider: "missing", id: "recovery" });

    expect(groups.map((group) => [group.id, group.label, group.models.length])).toEqual([
      ["groland", "Groland", 2],
      ["openai", "OpenAI", 1],
      ["missing", "missing", 1]
    ]);
    expect(groups.at(-1)?.models[0]).toMatchObject({ provider: "missing", id: "recovery", configured: false });
  });
});
