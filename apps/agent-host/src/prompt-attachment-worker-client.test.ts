import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreparedPromptAttachment } from "@pi67/pi-runtime";
import {
  PromptAttachmentWorkerPool,
  type PromptAttachmentWorkerHandle
} from "./prompt-attachment-worker-client.js";
import type {
  PromptAttachmentWorkerResponse,
  PromptAttachmentWorkerTask
} from "./prompt-attachment-worker-contract.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("PromptAttachmentWorkerPool", () => {
  it("runs at most two extraction workers and dispatches queued work in order", async () => {
    const fixture = createPool();
    const first = fixture.pool.run(input("first.txt"));
    const second = fixture.pool.run(input("second.txt"));
    const third = fixture.pool.run(input("third.txt"));

    await vi.waitFor(() => expect(fixture.workers).toHaveLength(2));
    await vi.waitFor(() => expect(fixture.workers[0]?.tasks).toHaveLength(1));
    await vi.waitFor(() => expect(fixture.workers[1]?.tasks).toHaveLength(1));
    expect(fixture.workers[0]?.tasks[0]?.attachment.name).toBe("first.txt");
    expect(fixture.workers[1]?.tasks[0]?.attachment.name).toBe("second.txt");
    expect(fixture.workers[0]?.tasks[0]).not.toHaveProperty("path");
    expect(fixture.workers[0]?.tasks[0]?.bytes).toBeInstanceOf(ArrayBuffer);

    fixture.workers[0]?.succeed("first");
    await expect(first).resolves.toEqual({ text: "first", truncated: false });
    expect(fixture.workers[0]?.tasks[1]?.attachment.name).toBe("third.txt");

    fixture.workers[1]?.succeed("second");
    fixture.workers[0]?.succeed("third");
    await expect(second).resolves.toEqual({ text: "second", truncated: false });
    await expect(third).resolves.toEqual({ text: "third", truncated: false });
    await fixture.pool.dispose();
  });

  it("serializes OCR while allowing an ordinary extraction to use the other slot", async () => {
    const fixture = createPool();
    const image = fixture.pool.run(input("image.png", "image", "image/png"));
    const pdf = fixture.pool.run(input("scan.pdf", "document", "application/pdf"));
    const text = fixture.pool.run(input("notes.txt"));

    await vi.waitFor(() => expect(fixture.workers).toHaveLength(2));
    await vi.waitFor(() => expect(fixture.workers[0]?.tasks).toHaveLength(1));
    await vi.waitFor(() => expect(fixture.workers[1]?.tasks).toHaveLength(1));
    expect(fixture.workers[0]?.tasks.map(task => task.attachment.name)).toEqual(["image.png"]);
    expect(fixture.workers[1]?.tasks.map(task => task.attachment.name)).toEqual(["notes.txt"]);

    fixture.workers[1]?.succeed("notes");
    await expect(text).resolves.toEqual({ text: "notes", truncated: false });
    expect(fixture.workers.flatMap(worker => worker.tasks).map(task => task.attachment.name))
      .not.toContain("scan.pdf");

    fixture.workers[0]?.succeed("image text");
    await expect(image).resolves.toEqual({ text: "image text", truncated: false });
    expect(fixture.workers[0]?.tasks[1]?.attachment.name).toBe("scan.pdf");
    fixture.workers[0]?.succeed("pdf text");
    await expect(pdf).resolves.toEqual({ text: "pdf text", truncated: false });
    await fixture.pool.dispose();
  });

  it("bounds pending work and cancels both queued and active tasks", async () => {
    const fixture = createPool({ maxWorkers: 1, maxQueue: 2 });
    const activeController = new AbortController();
    const active = fixture.pool.run(input("active.txt"), activeController.signal);
    const queuedController = new AbortController();
    const queued = fixture.pool.run(input("queued.txt"), queuedController.signal);

    await expect(fixture.pool.run(input("overflow.txt"))).rejects.toThrow("queue is full");
    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.workers[0]?.tasks).toHaveLength(1);

    activeController.abort();
    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.workers[0]?.terminateCalls).toBe(1);
    await fixture.pool.dispose();
  });

  it("loads bytes only after a worker slot admits the queued task", async () => {
    const fixture = createPool({ maxWorkers: 1, maxQueue: 2 });
    const firstBytes = vi.fn(async () => new Uint8Array(10).buffer);
    const secondBytes = vi.fn(async () => new Uint8Array(10).buffer);
    const first = fixture.pool.runDeferred(deferredInput("first.txt"), firstBytes);
    const second = fixture.pool.runDeferred(deferredInput("second.txt"), secondBytes);

    await vi.waitFor(() => expect(firstBytes).toHaveBeenCalledOnce());
    expect(secondBytes).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fixture.workers[0]?.tasks).toHaveLength(1));

    fixture.workers[0]?.succeed("first");
    await expect(first).resolves.toEqual({ text: "first", truncated: false });
    await vi.waitFor(() => expect(secondBytes).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fixture.workers[0]?.tasks).toHaveLength(2));

    fixture.workers[0]?.succeed("second");
    await expect(second).resolves.toEqual({ text: "second", truncated: false });
    await fixture.pool.dispose();
  });

  it("rejects a deferred payload whose verified length no longer matches metadata", async () => {
    const fixture = createPool({ maxWorkers: 1 });

    await expect(fixture.pool.runDeferred(
      deferredInput("changed.txt"),
      async () => new Uint8Array(9).buffer
    )).rejects.toThrow("payload length changed");
    expect(fixture.workers[0]?.tasks).toHaveLength(0);
    await fixture.pool.dispose();
  });

  it("terminates timed-out workers and replaces workers that error or exit", async () => {
    vi.useFakeTimers();
    const fixture = createPool({ maxWorkers: 1, parseTimeoutMs: 25 });
    const timedOut = fixture.pool.run(input("timeout.txt"));
    const timedOutResult = expect(timedOut).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(25);
    await timedOutResult;
    expect(fixture.workers[0]?.terminateCalls).toBe(1);

    const failed = fixture.pool.run(input("error.txt"));
    fixture.workers[1]?.emit("error", new Error("worker failed"));
    await expect(failed).rejects.toThrow("worker failed");

    const exited = fixture.pool.run(input("exit.txt"));
    fixture.workers[2]?.emit("exit", 17);
    await expect(exited).rejects.toThrow("exited with code 17");
    await fixture.pool.dispose();
  });

  it("rejects queued and active work when disposed", async () => {
    const fixture = createPool({ maxWorkers: 1 });
    const active = fixture.pool.run(input("active.txt"));
    const queued = fixture.pool.run(input("queued.txt"));
    const activeResult = expect(active).rejects.toThrow("extraction stopped");
    const queuedResult = expect(queued).rejects.toThrow("extraction stopped");

    await fixture.pool.dispose();

    await activeResult;
    await queuedResult;
    await expect(fixture.pool.run(input("after.txt"))).rejects.toThrow("extraction is unavailable");
  });
});

function createPool(options: {
  maxWorkers?: number;
  maxQueue?: number;
  parseTimeoutMs?: number;
} = {}): { pool: PromptAttachmentWorkerPool; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const pool = new PromptAttachmentWorkerPool("/tmp/pi67-test-ocr", {
    ...options,
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  return { pool, workers };
}

function input(
  name: string,
  kind: PreparedPromptAttachment["kind"] = "document",
  mimeType = "text/plain"
): Omit<PromptAttachmentWorkerTask, "id" | "ocrDataRoot"> {
  return {
    bytes: new Uint8Array(10).buffer,
    attachment: {
      id: `attachment_${name.replace(/[^A-Za-z0-9]/gu, "_")}`,
      name,
      mimeType,
      byteLength: 10,
      kind
    },
    operation: "read_text"
  };
}

function deferredInput(
  name: string,
  kind: PreparedPromptAttachment["kind"] = "document",
  mimeType = "text/plain"
): Omit<PromptAttachmentWorkerTask, "id" | "ocrDataRoot" | "bytes"> {
  const { bytes: _bytes, ...metadata } = input(name, kind, mimeType);
  return metadata;
}

class FakeWorker extends EventEmitter implements PromptAttachmentWorkerHandle {
  readonly tasks: PromptAttachmentWorkerTask[] = [];
  terminateCalls = 0;

  postMessage(task: PromptAttachmentWorkerTask, transferList: ArrayBuffer[]): void {
    expect(transferList).toEqual([task.bytes]);
    this.tasks.push(task);
  }

  terminate(): Promise<number> {
    this.terminateCalls += 1;
    return Promise.resolve(0);
  }

  succeed(text: string, truncated = false): void {
    const task = this.tasks.at(-1);
    if (!task) throw new Error("No worker task is active.");
    const response: PromptAttachmentWorkerResponse = { id: task.id, ok: true, text, truncated };
    this.emit("message", response);
  }
}
