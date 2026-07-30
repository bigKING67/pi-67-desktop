import { describe, expect, it, vi } from "vitest";
import {
  createCodeHighlighterBridge,
  type HighlightRequest,
  type HighlightResponse,
  type HighlightWorker
} from "./code-highlighter.js";

describe("code highlighter Worker bridge", () => {
  it("correlates out-of-order Worker responses by request ID", async () => {
    const worker = new FakeHighlightWorker();
    const bridge = createCodeHighlighterBridge(() => worker);

    const first = bridge.highlight("first", "ts");
    const second = bridge.highlight("second", "ts");
    expect(worker.requests.map((request) => request.id)).toEqual([1, 2]);

    worker.emitMessage({ id: 2, ok: true, lines: [[{ content: "second" }]], resources: [] });
    worker.emitMessage({ id: 999, ok: true, lines: [[{ content: "unknown" }]], resources: [] });
    worker.emitMessage({ id: 1, ok: true, lines: [[{ content: "first" }]], resources: [] });

    await expect(first).resolves.toEqual([[{ content: "first" }]]);
    await expect(second).resolves.toEqual([[{ content: "second" }]]);
  });

  it("rejects one failed response without disturbing other requests", async () => {
    const worker = new FakeHighlightWorker();
    const bridge = createCodeHighlighterBridge(() => worker);
    const failed = bridge.highlight("bad", "ts");
    const successful = bridge.highlight("good", "ts");

    worker.emitMessage({ id: 1, ok: false, error: "fixture syntax error" });
    worker.emitMessage({ id: 2, ok: true, lines: [[{ content: "good" }]], resources: [] });

    await expect(failed).rejects.toThrow("fixture syntax error");
    await expect(successful).resolves.toEqual([[{ content: "good" }]]);
  });

  for (const event of ["error", "messageerror"] as const) {
    it(`rejects every pending request after Worker ${event} and recreates the Worker`, async () => {
      const workers = [new FakeHighlightWorker(), new FakeHighlightWorker()];
      const factory = vi.fn(() => workers.shift()!);
      const bridge = createCodeHighlighterBridge(factory);
      const first = bridge.highlight("first", "ts");
      const second = bridge.highlight("second", "ts");

      factory.mock.results[0]!.value.emit(event);
      await expect(first).rejects.toThrow(/syntax-highlighting worker/iu);
      await expect(second).rejects.toThrow(/syntax-highlighting worker/iu);
      expect(factory.mock.results[0]!.value.terminated).toBe(true);

      const recovered = bridge.highlight("recovered", "ts");
      expect(factory).toHaveBeenCalledTimes(2);
      factory.mock.results[1]!.value.emitMessage({
        id: 3,
        ok: true,
        lines: [[{ content: "recovered" }]],
        resources: []
      });
      await expect(recovered).resolves.toEqual([[{ content: "recovered" }]]);
    });
  }
});

class FakeHighlightWorker implements HighlightWorker {
  readonly requests: HighlightRequest[] = [];
  terminated = false;
  private messageListener: ((event: MessageEvent<HighlightResponse>) => void) | undefined;
  private errorListeners = new Map<"error" | "messageerror", (event: Event) => void>();

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<HighlightResponse>) => void) | ((event: Event) => void)
  ): void {
    if (type === "message") {
      this.messageListener = listener as (event: MessageEvent<HighlightResponse>) => void;
      return;
    }
    this.errorListeners.set(type, listener as (event: Event) => void);
  }

  postMessage(request: HighlightRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(response: HighlightResponse): void {
    this.messageListener?.({ data: response } as MessageEvent<HighlightResponse>);
  }

  emit(type: "error" | "messageerror"): void {
    this.errorListeners.get(type)?.(new Event(type));
  }
}
