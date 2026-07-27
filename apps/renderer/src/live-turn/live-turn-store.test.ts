import type { OperationView } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { useLiveTurnStore } from "./live-turn-store.js";

describe("live turn store", () => {
  beforeEach(() => {
    useLiveTurnStore.getState().reset();
  });

  it("rejects stream deltas from another operation", () => {
    useLiveTurnStore.getState().begin(operation("operation-a"), 7);

    expect(useLiveTurnStore.getState().append({ text: "stale", thinking: "" }, {
      hostEpoch: 7,
      sessionId: "session-a",
      sessionGeneration: 3,
      operationId: "operation-b"
    })).toBe(false);
    expect(useLiveTurnStore.getState().textChunks).toEqual([]);
  });

  it("coalesces small deltas into bounded chunks", () => {
    useLiveTurnStore.getState().begin(operation("operation-a"), 7);
    for (let index = 0; index < 100; index += 1) {
      useLiveTurnStore.getState().append({ text: "x".repeat(1_000), thinking: "" }, {
        hostEpoch: 7,
        sessionId: "session-a",
        sessionGeneration: 3,
        operationId: "operation-a"
      });
    }

    const chunks = useLiveTurnStore.getState().textChunks;
    expect(chunks.join("")).toHaveLength(100_000);
    expect(chunks.length).toBeLessThanOrEqual(7);
  });

  it("keeps completed text until the settled conversation page arrives", () => {
    useLiveTurnStore.getState().begin(operation("operation-a"), 7);
    useLiveTurnStore.getState().append({ text: "result", thinking: "analysis" }, {
      hostEpoch: 7,
      sessionId: "session-a",
      sessionGeneration: 3,
      operationId: "operation-a"
    });

    useLiveTurnStore.getState().finish("operation-a", "completed");
    expect(useLiveTurnStore.getState().textChunks.join("")).toBe("result");
    useLiveTurnStore.getState().settle("operation-a");
    expect(useLiveTurnStore.getState().textChunks).toEqual([]);
    expect(useLiveTurnStore.getState().thinkingChunks).toEqual([]);
  });

  it("clears failed operations immediately", () => {
    useLiveTurnStore.getState().begin(operation("operation-a"), 7);
    useLiveTurnStore.getState().append({ text: "partial", thinking: "" }, {
      operationId: "operation-a"
    });

    useLiveTurnStore.getState().finish("operation-a", "failed");
    expect(useLiveTurnStore.getState().textChunks).toEqual([]);
    expect(useLiveTurnStore.getState().authority).toBeUndefined();
  });
});

function operation(operationId: string): OperationView {
  return {
    operationId,
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-a",
    sessionGeneration: 3,
    startedAt: 1
  };
}
