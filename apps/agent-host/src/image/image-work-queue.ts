import { HostCommandError } from "../protocol-error.js";

const IMAGE_QUEUE_LIMITS = { perProject: 32, total: 256, renders: 2 } as const;

/**
 * Serializes writes per project (edits, decisions, renders) while different
 * projects proceed in parallel, and caps concurrent renders host-wide. The
 * engine's `base_revision` check remains the correctness rule; the queue only
 * keeps one writer per project in order and bounds memory.
 */
export class ImageWorkQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly pending = new Map<string, number>();
  private total = 0;
  private renders = 0;
  private readonly renderWaiters: (() => void)[] = [];

  constructor(private readonly limits: { perProject: number; total: number; renders: number } = IMAGE_QUEUE_LIMITS) {}

  /** Runs `work` after every earlier task for the same project settled. */
  serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const count = this.pending.get(key) ?? 0;
    if (count >= this.limits.perProject || this.total >= this.limits.total) {
      return Promise.reject(new HostCommandError("RESOURCE_LIMIT_EXCEEDED", "图像工程的待处理操作过多，请稍后再试。", true, { imageReason: "queue_full" }));
    }
    this.pending.set(key, count + 1); this.total++;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(() => undefined, () => undefined).finally(() => {
      const left = (this.pending.get(key) ?? 1) - 1;
      if (left === 0) { this.pending.delete(key); if (this.tails.get(key) === tail) this.tails.delete(key); }
      else this.pending.set(key, left);
      this.total--;
    });
    this.tails.set(key, tail);
    return run;
  }

  /** Holds one of the host-wide render slots for the duration of `work`. */
  async render<T>(work: () => Promise<T>, onRunning?: () => void, signal?: AbortSignal): Promise<T> {
    while (this.renders >= this.limits.renders) {
      signal?.throwIfAborted();
      await new Promise<void>((resolve) => {
        const wake = (): void => { signal?.removeEventListener("abort", wake); resolve(); };
        this.renderWaiters.push(wake);
        signal?.addEventListener("abort", wake, { once: true });
      });
    }
    signal?.throwIfAborted();
    this.renders++;
    try { onRunning?.(); return await work(); }
    finally { this.renders--; this.renderWaiters.shift()?.(); }
  }

  get activeRenders(): number { return this.renders; }
}
