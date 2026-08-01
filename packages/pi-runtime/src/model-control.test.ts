import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { selectSessionModel } from "./model-control.js";

describe("model control", () => {
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
    expect(setModel).toHaveBeenCalledWith(model);
  });
});
