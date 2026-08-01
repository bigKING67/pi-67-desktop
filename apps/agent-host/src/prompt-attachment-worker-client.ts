import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { PreparedPromptAttachment } from "@pi67/pi-runtime";
import type {
  PromptAttachmentWorkerResponse,
  PromptAttachmentWorkerTask
} from "./prompt-attachment-worker-contract.js";

interface QueuedTask {
  task: PromptAttachmentWorkerTask;
  signal?: AbortSignal;
  queueAbortCleanup?: () => void;
  resolve: (result: { text: string; truncated: boolean }) => void;
  reject: (error: unknown) => void;
}

export interface PromptAttachmentWorkerHandle {
  postMessage(value: PromptAttachmentWorkerTask): void;
  terminate(): Promise<number>;
  on(event: "message", listener: (response: PromptAttachmentWorkerResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
}

interface WorkerSlot {
  worker: PromptAttachmentWorkerHandle;
  active?: QueuedTask;
  timeout?: ReturnType<typeof setTimeout>;
  abortListener?: () => void;
}

const MAX_WORKERS = 2;
const MAX_QUEUE = 16;
const PARSE_TIMEOUT_MS = 60_000;
const OCR_TIMEOUT_MS = 120_000;

export interface PromptAttachmentWorkerPoolOptions {
  workerFactory?: () => PromptAttachmentWorkerHandle;
  maxWorkers?: number;
  maxQueue?: number;
  parseTimeoutMs?: number;
  ocrTimeoutMs?: number;
}

export class PromptAttachmentWorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: QueuedTask[] = [];
  private disposed = false;
  private ocrActive = false;
  private readonly workerFactory: () => PromptAttachmentWorkerHandle;
  private readonly maxWorkers: number;
  private readonly maxQueue: number;
  private readonly parseTimeoutMs: number;
  private readonly ocrTimeoutMs: number;

  constructor(
    private readonly ocrDataRoot: string,
    options: PromptAttachmentWorkerPoolOptions = {}
  ) {
    this.workerFactory = options.workerFactory ?? createPromptAttachmentWorker;
    this.maxWorkers = options.maxWorkers ?? MAX_WORKERS;
    this.maxQueue = options.maxQueue ?? MAX_QUEUE;
    this.parseTimeoutMs = options.parseTimeoutMs ?? PARSE_TIMEOUT_MS;
    this.ocrTimeoutMs = options.ocrTimeoutMs ?? OCR_TIMEOUT_MS;
  }

  run(
    input: Omit<PromptAttachmentWorkerTask, "id" | "ocrDataRoot">,
    signal?: AbortSignal
  ): Promise<{ text: string; truncated: boolean }> {
    if (this.disposed) return Promise.reject(new Error("Prompt attachment extraction is unavailable."));
    if (this.queue.length + this.activeCount() >= this.maxQueue) {
      return Promise.reject(new Error("Prompt attachment extraction queue is full."));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const queued: QueuedTask = {
        task: { ...input, id: randomUUID(), ocrDataRoot: this.ocrDataRoot },
        ...(signal === undefined ? {} : { signal }),
        resolve,
        reject
      };
      if (signal) {
        const listener = () => {
          const index = this.queue.indexOf(queued);
          if (index < 0) return;
          this.queue.splice(index, 1);
          queued.queueAbortCleanup?.();
          queued.reject(abortError());
          this.dispatch();
        };
        signal.addEventListener("abort", listener, { once: true });
        queued.queueAbortCleanup = () => signal.removeEventListener("abort", listener);
      }
      this.queue.push(queued);
      this.dispatch();
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const task of this.queue.splice(0)) {
      task.queueAbortCleanup?.();
      task.reject(new Error("Prompt attachment extraction stopped."));
    }
    await Promise.all(this.slots.map(async (slot) => {
      slot.active?.reject(new Error("Prompt attachment extraction stopped."));
      this.clearSlot(slot);
      await slot.worker.terminate();
    }));
    this.slots.length = 0;
  }

  private dispatch(): void {
    if (this.disposed) return;
    while (this.slots.length < this.maxWorkers && this.queue.length > this.idleCount()) {
      this.slots.push(this.createSlot());
    }
    for (const slot of this.slots) {
      if (slot.active) continue;
      const index = this.queue.findIndex((task) => !requiresOcr(task.task.attachment) || !this.ocrActive);
      if (index < 0) continue;
      const [queued] = this.queue.splice(index, 1);
      if (!queued) continue;
      queued.queueAbortCleanup?.();
      delete queued.queueAbortCleanup;
      if (queued.signal?.aborted) {
        queued.reject(abortError());
        continue;
      }
      slot.active = queued;
      if (requiresOcr(queued.task.attachment)) this.ocrActive = true;
      const timeoutMs = requiresOcr(queued.task.attachment) ? this.ocrTimeoutMs : this.parseTimeoutMs;
      slot.timeout = setTimeout(() => this.failSlot(slot, new Error("Prompt attachment extraction timed out.")), timeoutMs);
      if (queued.signal) {
        const listener = () => this.failSlot(slot, abortError());
        queued.signal.addEventListener("abort", listener, { once: true });
        slot.abortListener = () => queued.signal?.removeEventListener("abort", listener);
      }
      slot.worker.postMessage(queued.task);
    }
  }

  private createSlot(): WorkerSlot {
    const slot: WorkerSlot = {
      worker: this.workerFactory()
    };
    slot.worker.on("message", (response: PromptAttachmentWorkerResponse) => this.handleResponse(slot, response));
    slot.worker.on("error", (error) => this.failSlot(slot, error));
    slot.worker.on("exit", (code) => {
      if (this.disposed) return;
      if (slot.active) this.failSlot(slot, new Error(`Prompt attachment worker exited with code ${code}.`));
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots.splice(index, 1);
      this.dispatch();
    });
    return slot;
  }

  private handleResponse(slot: WorkerSlot, response: PromptAttachmentWorkerResponse): void {
    const active = slot.active;
    if (!active || response.id !== active.task.id) return;
    this.clearSlot(slot);
    if (response.ok) active.resolve({ text: response.text, truncated: response.truncated });
    else active.reject(new Error(response.error));
    this.dispatch();
  }

  private failSlot(slot: WorkerSlot, error: unknown): void {
    const active = slot.active;
    this.clearSlot(slot);
    active?.reject(error);
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    void slot.worker.terminate().finally(() => this.dispatch());
  }

  private clearSlot(slot: WorkerSlot): void {
    if (slot.active && requiresOcr(slot.active.task.attachment)) this.ocrActive = false;
    if (slot.timeout) clearTimeout(slot.timeout);
    slot.abortListener?.();
    delete slot.active;
    delete slot.timeout;
    delete slot.abortListener;
  }

  private activeCount(): number {
    return this.slots.filter((slot) => slot.active !== undefined).length;
  }

  private idleCount(): number {
    return this.slots.filter((slot) => slot.active === undefined).length;
  }
}

function createPromptAttachmentWorker(): PromptAttachmentWorkerHandle {
  return new Worker(new URL("./prompt-attachment-worker.mjs", import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: 384 }
  });
}

function requiresOcr(attachment: PreparedPromptAttachment): boolean {
  return attachment.kind === "image" || attachment.mimeType === "application/pdf";
}

function abortError(): Error {
  const error = new Error("Prompt attachment extraction was cancelled.");
  error.name = "AbortError";
  return error;
}
