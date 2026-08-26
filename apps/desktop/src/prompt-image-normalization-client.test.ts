import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  PromptImageNormalizationWorker,
  type PromptImageNormalizationWorkerHandle
} from "./prompt-image-normalization-client.js";
import type {
  PromptImageNormalizationWorkerResponse,
  PromptImageNormalizationWorkerTask
} from "./prompt-image-normalization-worker-contract.js";

describe("PromptImageNormalizationWorker", () => {
  it("accepts one exact response, terminates the worker, and ignores raw error details", async () => {
    const worker = new FakeWorker((task, current) => {
      queueMicrotask(() => current.emitMessage({
        id: task.id,
        ok: true,
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
        width: 10,
        height: 10
      }));
    });
    const client = new PromptImageNormalizationWorker({ workerFactory: () => worker });

    await expect(client.normalize("/private/staged/payload.bin", 4)).resolves.toMatchObject({
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      width: 10,
      height: 10
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("maps bounded failure codes to retryable messages and terminates", async () => {
    const worker = new FakeWorker((task, current) => {
      queueMicrotask(() => current.emitMessage({ id: task.id, ok: false, code: "pixel_budget" }));
    });
    const client = new PromptImageNormalizationWorker({ workerFactory: () => worker });

    await expect(client.normalize("/private/staged/payload.bin", 4)).rejects.toThrow("5,000 万像素");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("times out and cancels active work during disposal", async () => {
    vi.useFakeTimers();
    try {
      const timeoutWorker = new FakeWorker();
      const timed = new PromptImageNormalizationWorker({
        workerFactory: () => timeoutWorker,
        timeoutMs: 25
      });
      const timeoutResult = timed.normalize("/private/staged/payload.bin", 4);
      const timeoutAssertion = expect(timeoutResult).rejects.toThrow("转换超时");
      await vi.advanceTimersByTimeAsync(25);
      await timeoutAssertion;

      const activeWorker = new FakeWorker();
      const active = new PromptImageNormalizationWorker({ workerFactory: () => activeWorker });
      const activeResult = active.normalize("/private/staged/payload.bin", 4);
      await active.dispose();
      await expect(activeResult).rejects.toThrow("已停止");
      expect(activeWorker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

class FakeWorker extends EventEmitter implements PromptImageNormalizationWorkerHandle {
  readonly terminate = vi.fn(async () => 0);

  constructor(
    private readonly onPost?: (task: PromptImageNormalizationWorkerTask, worker: FakeWorker) => void
  ) {
    super();
  }

  postMessage(value: PromptImageNormalizationWorkerTask): void {
    this.onPost?.(value, this);
  }

  emitMessage(response: PromptImageNormalizationWorkerResponse): void {
    this.emit("message", response);
  }
}
