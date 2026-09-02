import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it, vi } from "vitest";
import { selectSessionModel, setSessionThinkingLevel } from "./model-control.js";

describe("model control", () => {
  it("exposes the Pi 0.84 DeepSeek Flash thinking levels without renderer-owned aliases", () => {
    const model = getBuiltinModel("deepseek", "deepseek-v4-flash");

    expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "high", "max"]);
  });

  it("does not append another Pi model change when the requested model is already active", async () => {
    const getModel = vi.fn();
    const setModel = vi.fn();
    const session = {
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      modelRuntime: { getModel },
      setModel
    } as unknown as AgentSession;

    await selectSessionModel(session, "deepseek", "deepseek-v4-flash");

    expect(getModel).not.toHaveBeenCalled();
    expect(setModel).not.toHaveBeenCalled();
  });

  it("resolves and selects a different available Pi model exactly once", async () => {
    const model = { provider: "anthropic", id: "claude-sonnet" };
    const getModel = vi.fn(() => model);
    const setModel = vi.fn(async () => undefined);
    const session = {
      model: { provider: "openai", id: "gpt" },
      modelRuntime: { getModel },
      setModel
    } as unknown as AgentSession;

    await selectSessionModel(session, "anthropic", "claude-sonnet");

    expect(getModel).toHaveBeenCalledOnce();
    expect(getModel).toHaveBeenCalledWith("anthropic", "claude-sonnet");
    expect(setModel).toHaveBeenCalledOnce();
    expect(setModel).toHaveBeenCalledWith(model, { persist: true });
  });

  it("persists a supported thinking level through the Pi Session", () => {
    const setThinkingLevel = vi.fn();
    const session = {
      getAvailableThinkingLevels: () => ["off", "low", "high", "max"],
      setThinkingLevel
    } as unknown as AgentSession;

    setSessionThinkingLevel(session, "max");

    expect(setThinkingLevel).toHaveBeenCalledOnce();
    expect(setThinkingLevel).toHaveBeenCalledWith("max", { persist: true });
  });
});
