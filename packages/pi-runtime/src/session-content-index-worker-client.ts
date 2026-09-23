import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { contentIndexRequestWithinBudget, isContentIndexReply, type ContentIndexWorkerRequest, type ContentIndexWorkerReply } from "./session-content-index-worker-contract.js";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PENDING_REQUESTS = 8;

export class ContentIndexWorkerClient {
  private worker: Worker | undefined;
  private nextId = 0;
  private generation = 0;
  private disposed = false;
  private pending = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private stopping: Promise<unknown> = Promise.resolve();
  private rejectActive: ((error: Error) => void) | undefined;

  constructor(private readonly directory: string, private readonly storageRoot?: string) {}

  request(input: Omit<ContentIndexWorkerRequest, "id">, signal?: AbortSignal): Promise<ContentIndexWorkerReply> {
    if (this.disposed || signal?.aborted || this.pending >= MAX_PENDING_REQUESTS || !contentIndexRequestWithinBudget(input)) {
      return Promise.reject(new Error("Content index request is unavailable."));
    }
    const generation = this.generation;
    this.pending++;
    const run = this.tail.then(async () => {
      await this.stopping;
      if (this.disposed || generation !== this.generation || signal?.aborted) throw new Error("Content index request was cancelled.");
      return this.send({ ...input, id: ++this.nextId }, signal);
    });
    this.tail = run.catch(() => undefined);
    const settled = run.finally(() => { this.pending--; });
    if (!signal) return settled;
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error("Content index request was cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      void settled.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    });
  }

  reset(): void {
    this.generation++;
    this.rejectActive?.(new Error("Content index request was cancelled."));
    const worker = this.worker;
    this.worker = undefined;
    if (worker) this.stopping = Promise.allSettled([this.stopping, worker.terminate()]);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.reset();
    await this.stopping;
    await this.tail;
  }

  private send(request: ContentIndexWorkerRequest, signal?: AbortSignal): Promise<ContentIndexWorkerReply> {
    if (!this.worker) {
      // Source tests build this entry first; bundled runtime resolves its sibling entry.
      const entry = new URL(import.meta.url.endsWith(".ts")
        ? "../dist/session-content-index-worker.mjs" : "./session-content-index-worker.mjs", import.meta.url);
      this.worker = new Worker(entry, {
        workerData: { directory: resolve(this.directory), storageRoot: this.storageRoot === undefined ? undefined : resolve(this.storageRoot) },
        stdout: true, stderr: true
      });
      this.worker.stdout?.resume();
      this.worker.stderr?.resume();
      const created = this.worker;
      const retire = () => { if (this.worker === created) this.reset(); };
      created.on("error", retire);
      created.on("exit", retire);
      this.worker.unref();
    }
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.off("message", onMessage); worker.off("error", onError); worker.off("exit", onExit);
        signal?.removeEventListener("abort", onAbort);
        this.rejectActive = undefined;
      };
      const fail = () => { cleanup(); this.reset(); reject(new Error("Content index worker failed.")); };
      const onError = () => fail();
      const onExit = () => fail();
      const onAbort = () => fail();
      const onMessage = (reply: unknown) => {
        if (!isContentIndexReply(reply, request)) { fail(); return; }
        cleanup();
        if (reply.ok) resolve(reply);
        else { this.reset(); reject(new Error("Content index worker could not complete the request.")); }
      };
      const timer = setTimeout(fail, REQUEST_TIMEOUT_MS);
      this.rejectActive = error => { cleanup(); reject(error); };
      worker.on("message", onMessage); worker.once("error", onError); worker.once("exit", onExit);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      try { worker.postMessage(request); } catch { fail(); }
    });
  }
}
