import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { MAX_PROMPT_HEIC_SOURCE_BYTES } from "./prompt-image-inspection.js";
import type {
  PromptImageNormalizationFailureCode,
  PromptImageNormalizationWorkerResponse,
  PromptImageNormalizationWorkerTask
} from "./prompt-image-normalization-worker-contract.js";

export interface PromptImageNormalizationResult {
  bytes: Buffer;
  width: number;
  height: number;
}

export interface PromptImageNormalizer {
  normalize(
    sourcePath: string,
    sourceByteLength: number,
    signal?: AbortSignal
  ): Promise<PromptImageNormalizationResult>;
  dispose(): Promise<void>;
}

export interface PromptImageNormalizationWorkerHandle {
  postMessage(value: PromptImageNormalizationWorkerTask): void;
  terminate(): Promise<number>;
  on(event: "message", listener: (response: PromptImageNormalizationWorkerResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
}

interface ActiveNormalization {
  worker: PromptImageNormalizationWorkerHandle;
  cancel(error: Error): Promise<number>;
}

export interface PromptImageNormalizationWorkerOptions {
  workerFactory?: () => PromptImageNormalizationWorkerHandle;
  timeoutMs?: number;
}

const NORMALIZATION_TIMEOUT_MS = 45_000;

export class PromptImageNormalizationWorker implements PromptImageNormalizer {
  private readonly active = new Set<ActiveNormalization>();
  private readonly workerFactory: () => PromptImageNormalizationWorkerHandle;
  private readonly timeoutMs: number;
  private disposed = false;

  constructor(options: PromptImageNormalizationWorkerOptions = {}) {
    this.workerFactory = options.workerFactory ?? createPromptImageNormalizationWorker;
    this.timeoutMs = options.timeoutMs ?? NORMALIZATION_TIMEOUT_MS;
  }

  normalize(
    sourcePath: string,
    sourceByteLength: number,
    signal?: AbortSignal
  ): Promise<PromptImageNormalizationResult> {
    if (this.disposed) return Promise.reject(new Error("HEIC/HEIF 图片转换服务已停止。"));
    if (signal?.aborted) return Promise.reject(abortError());
    if (!Number.isSafeInteger(sourceByteLength) || sourceByteLength <= 0
      || sourceByteLength > MAX_PROMPT_HEIC_SOURCE_BYTES) {
      return Promise.reject(new Error("HEIC/HEIF 图片超过 32 MiB 源文件上限，草稿已保留，请压缩后重试。"));
    }
    const task: PromptImageNormalizationWorkerTask = {
      id: randomUUID(),
      sourcePath,
      sourceByteLength
    };
    return new Promise((resolve, reject) => {
      const worker = this.workerFactory();
      const active: ActiveNormalization = {
        worker,
        cancel: async () => 0
      };
      this.active.add(active);
      let settled = false;
      const finish = (operation: () => void): Promise<number> => {
        if (settled) return Promise.resolve(0);
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", handleAbort);
        this.active.delete(active);
        operation();
        return worker.terminate();
      };
      const handleAbort = () => void finish(() => reject(abortError()));
      const timeout = setTimeout(() => void finish(() => reject(new Error(
        "HEIC/HEIF 图片转换超时，草稿已保留，可以重新选择重试。"
      ))), this.timeoutMs);
      active.cancel = (error) => finish(() => reject(error));
      signal?.addEventListener("abort", handleAbort, { once: true });
      worker.on("message", (response) => {
        if (response.id !== task.id) return;
        if (!response.ok) {
          void finish(() => reject(new Error(normalizationFailureMessage(response.code))));
          return;
        }
        if (!(response.bytes instanceof ArrayBuffer) || response.bytes.byteLength === 0
          || response.bytes.byteLength > MAX_PROMPT_HEIC_SOURCE_BYTES
          || !Number.isSafeInteger(response.width) || !Number.isSafeInteger(response.height)) {
          void finish(() => reject(new Error("HEIC/HEIF 图片转换返回了无效结果，草稿已保留，请重试。")));
          return;
        }
        void finish(() => resolve({
          bytes: Buffer.from(response.bytes),
          width: response.width,
          height: response.height
        }));
      });
      worker.on("error", () => void finish(() => reject(new Error(
        "HEIC/HEIF 图片转换进程失败，草稿已保留，可以重新选择重试。"
      ))));
      worker.on("exit", (code) => {
        void finish(() => reject(new Error(
          `HEIC/HEIF 图片转换进程意外退出（${code}），草稿已保留，可以重新选择重试。`
        )));
      });
      try {
        worker.postMessage(task);
      } catch {
        void finish(() => reject(new Error(
          "HEIC/HEIF 图片转换任务无法启动，草稿已保留，可以重新选择重试。"
        )));
      }
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.active].map((active) => (
      active.cancel(new Error("HEIC/HEIF 图片转换已停止。"))
    )));
  }
}

function createPromptImageNormalizationWorker(): PromptImageNormalizationWorkerHandle {
  return new Worker(new URL("./prompt-image-normalization-worker.mjs", import.meta.url), {
    resourceLimits: {
      maxOldGenerationSizeMb: 384,
      stackSizeMb: 8
    }
  });
}

function normalizationFailureMessage(code: PromptImageNormalizationFailureCode): string {
  if (code === "source_changed") return "HEIC/HEIF 图片在转换前发生了变化，草稿已保留，请重新选择。";
  if (code === "pixel_budget") {
    return "HEIC/HEIF 图片超过 5,000 万像素或 16,384 像素单边上限，草稿已保留，请缩小后重试。";
  }
  if (code === "output_budget") {
    return "转换后的 JPEG 超过 32 MiB 图片上限，草稿已保留，请缩小后重试。";
  }
  if (code === "encode_failed") {
    return "HEIC/HEIF 图片无法编码为 JPEG，草稿已保留，可以重新选择重试。";
  }
  return "无法解码该 HEIC/HEIF 图片，草稿已保留，可以重新选择重试。";
}

function abortError(): Error {
  const error = new Error("HEIC/HEIF 图片转换已取消，草稿已保留。");
  error.name = "AbortError";
  return error;
}
