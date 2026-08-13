import { randomUUID } from "node:crypto";
import { ipcMain, type BrowserWindow } from "electron";

const REQUEST_CHANNEL = "pi67:renderer-shutdown-checkpoint-requested";
const COMPLETE_CHANNEL = "pi67:renderer-shutdown-checkpoint-complete";
const DEFAULT_TIMEOUT_MS = 5_000;

export interface RendererShutdownCheckpointRegistration {
  request(): Promise<boolean>;
  dispose(): void;
}

interface RendererShutdownCheckpointOptions {
  getMainWindow(): BrowserWindow | undefined;
  timeoutMs?: number;
}

export function registerRendererShutdownCheckpoint(
  options: RendererShutdownCheckpointOptions
): RendererShutdownCheckpointRegistration {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new RangeError("Renderer shutdown checkpoint timeout is invalid.");
  }
  let pending: PendingCheckpoint | undefined;
  let disposed = false;

  ipcMain.handle(COMPLETE_CHANNEL, (event, value: unknown) => {
    const response = parseResponse(value);
    const window = options.getMainWindow();
    if (
      !response
      || !pending
      || response.requestId !== pending.requestId
      || !window
      || window.isDestroyed()
      || window.webContents.isDestroyed()
      || event.sender !== window.webContents
    ) return false;
    settle(response.succeeded);
    return true;
  });

  const settle = (succeeded: boolean): void => {
    const current = pending;
    if (!current) return;
    pending = undefined;
    clearTimeout(current.timer);
    current.resolve(succeeded);
  };

  return {
    request() {
      if (disposed) return Promise.resolve(false);
      if (pending) return pending.promise;
      const window = options.getMainWindow();
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
        return Promise.resolve(false);
      }
      const requestId = randomUUID();
      let resolveRequest!: (value: boolean) => void;
      const promise = new Promise<boolean>((resolve) => { resolveRequest = resolve; });
      pending = {
        requestId,
        promise,
        resolve: resolveRequest,
        timer: setTimeout(() => settle(false), timeoutMs)
      };
      try {
        window.webContents.send(REQUEST_CHANNEL, { requestId });
      } catch {
        settle(false);
      }
      return promise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      settle(false);
      ipcMain.removeHandler(COMPLETE_CHANNEL);
    }
  };
}

interface PendingCheckpoint {
  requestId: string;
  promise: Promise<boolean>;
  resolve(value: boolean): void;
  timer: ReturnType<typeof setTimeout>;
}

function parseResponse(value: unknown): { requestId: string; succeeded: boolean } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const response = value as Record<string, unknown>;
  if (
    Object.keys(response).length !== 2
    || typeof response.requestId !== "string"
    || response.requestId.length === 0
    || response.requestId.length > 200
    || typeof response.succeeded !== "boolean"
  ) return undefined;
  return { requestId: response.requestId, succeeded: response.succeeded };
}
