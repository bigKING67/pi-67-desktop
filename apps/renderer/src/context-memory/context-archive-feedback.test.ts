import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import type { ConnectionSubscriber } from "../connection/agent-connection-controller-contract.js";
const f = vi.hoisted(() => ({ subscriber: undefined as ConnectionSubscriber | undefined,
  unsubscribe: vi.fn(), commit: vi.fn() }));
vi.mock("../connection/AgentConnectionController.js", () => ({ agentConnectionController: {
  subscribe: (subscriber: ConnectionSubscriber) => { f.subscriber = subscriber; return f.unsubscribe; },
} }));
vi.mock("./context-memory-controller.js", () => ({ commitContextSession: f.commit }));
import { archiveWithFeedback } from "./context-archive-feedback.js";

function emit(outcome: string, operationId = "operation", sessionId = "session", workspaceId = "workspace") {
  f.subscriber?.onEvent?.({ type: "context.commitCompleted", payload: { operationId, sessionId, outcome } } as AgentEvent,
    { context: { scope: "workspace", workspaceId } } as EventEnvelope);
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe("archive operation feedback", () => {
  it("keeps a matching result that arrives before acknowledgement", async () => {
    f.commit.mockImplementation(async () => { emit("retained"); return { operationId: "operation" }; });
    const accepted = vi.fn();
    expect(await archiveWithFeedback("workspace", "session", new AbortController().signal, accepted)).toBe("retained");
    expect(accepted).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it("ignores other workspaces, Sessions and operations", async () => {
    f.commit.mockImplementation(async () => {
      emit("extracted", "other"); emit("extracted", "operation", "other");
      emit("extracted", "operation", "session", "other"); emit("empty");
      return { operationId: "operation" };
    });
    expect(await archiveWithFeedback("workspace", "session", new AbortController().signal, vi.fn())).toBe("empty");
  });
  it("cleans up and returns unknown on cancellation without resubmitting", async () => {
    const controller = new AbortController();
    f.commit.mockImplementation(async () => { controller.abort(); emit("extracted"); return { operationId: "operation" }; });
    const accepted = vi.fn();
    expect(await archiveWithFeedback("workspace", "session", controller.signal, accepted)).toBe("unconfirmed");
    expect(accepted).not.toHaveBeenCalled(); expect(f.commit).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it("reports failure and releases the listener", async () => {
    f.commit.mockImplementation(async () => {
      f.subscriber?.onEvent?.({ type: "context.commitFailed", payload: { operationId: "operation", sessionId: "session", detail: "secret" } },
        { context: { scope: "workspace", workspaceId: "workspace" } } as EventEnvelope);
      return { operationId: "operation" };
    });
    await expect(archiveWithFeedback("workspace", "session", new AbortController().signal, vi.fn())).rejects.toThrow("处理结果未知");
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it("bounds a missing terminal event", async () => {
    vi.useFakeTimers(); f.commit.mockResolvedValue({ operationId: "operation" });
    const pending = archiveWithFeedback("workspace", "session", new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(75_000);
    expect(await pending).toBe("unconfirmed"); expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
});
