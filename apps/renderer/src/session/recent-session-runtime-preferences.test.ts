import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetSessionRuntimePreference,
  recentSessionRuntimePreference,
  rememberSessionRuntimePreference,
  resetRecentSessionRuntimePreferencesForTests
} from "./recent-session-runtime-preferences.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("recent session runtime preferences", () => {
  beforeEach(() => resetRecentSessionRuntimePreferencesForTests());

  it("keeps the latest confirmed model and thinking level isolated by Workspace", () => {
    const storage = new MemoryStorage();
    expect(rememberSessionRuntimePreference("workspace-a", {
      selectedModel: { provider: "deepseek", id: "deepseek-v4-flash" },
      thinkingLevel: "high"
    }, { now: 10, storage })).toBe(true);
    expect(rememberSessionRuntimePreference("workspace-b", {
      selectedModel: { provider: "anthropic", id: "claude-sonnet-5" },
      thinkingLevel: "max"
    }, { now: 20, storage })).toBe(true);

    expect(recentSessionRuntimePreference("workspace-a", storage)).toEqual({
      model: { provider: "deepseek", model: "deepseek-v4-flash" },
      thinkingLevel: "high",
      updatedAt: 10
    });
    expect(recentSessionRuntimePreference("workspace-b", storage)?.model).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5"
    });
  });

  it("does not replace a valid preference with an unconfirmed model", () => {
    const storage = new MemoryStorage();
    rememberSessionRuntimePreference("workspace-a", {
      selectedModel: { provider: "deepseek", id: "deepseek-v4-flash" },
      thinkingLevel: "high"
    }, { now: 10, storage });

    expect(rememberSessionRuntimePreference("workspace-a", {
      thinkingLevel: "max"
    }, { now: 20, storage })).toBe(false);
    expect(recentSessionRuntimePreference("workspace-a", storage)?.updatedAt).toBe(10);
  });

  it("forgets only the requested Workspace and rejects malformed persisted data", () => {
    const storage = new MemoryStorage();
    rememberSessionRuntimePreference("workspace-a", {
      selectedModel: { provider: "deepseek", id: "deepseek-v4-flash" },
      thinkingLevel: "high"
    }, { storage });
    rememberSessionRuntimePreference("workspace-b", {
      selectedModel: { provider: "anthropic", id: "claude-sonnet-5" },
      thinkingLevel: "max"
    }, { storage });
    forgetSessionRuntimePreference("workspace-a", storage);
    expect(recentSessionRuntimePreference("workspace-a", storage)).toBeUndefined();
    expect(recentSessionRuntimePreference("workspace-b", storage)).toBeDefined();

    const corrupt = new MemoryStorage();
    corrupt.values.set("pi67.recent-session-runtime.v1", JSON.stringify({
      version: 1,
      items: [{ workspaceId: "workspace-a", model: { provider: "p", model: "m" }, updatedAt: 1, token: "forged" }]
    }));
    expect(recentSessionRuntimePreference("workspace-a", corrupt)).toBeUndefined();
  });
});
