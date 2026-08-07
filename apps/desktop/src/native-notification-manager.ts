import type {
  NativeNotificationActivation,
  NativeNotificationKind,
  NativeNotificationRequest
} from "@pi67/protocol";

const MAX_NATIVE_NOTIFICATION_DEDUPE_IDS = 512;

export interface NativeNotificationHandle {
  once(event: "click" | "close", listener: () => void): unknown;
  show(): void;
  close(): void;
}

interface NativeNotificationManagerOptions {
  isSupported: () => boolean;
  create: (presentation: { title: string; body: string }) => NativeNotificationHandle;
  activate: (activation: NativeNotificationActivation) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export class NativeNotificationManager {
  readonly #options: NativeNotificationManagerOptions;
  readonly #active = new Map<string, NativeNotificationHandle>();
  readonly #dedupeIds = new Set<string>();
  readonly #dedupeOrder: string[] = [];

  constructor(options: NativeNotificationManagerOptions) {
    this.#options = options;
  }

  show(request: NativeNotificationRequest): boolean {
    if (!this.#options.isSupported() || this.#dedupeIds.has(request.notificationId)) return false;
    let notification: NativeNotificationHandle | undefined;
    try {
      notification = this.#options.create(nativeNotificationPresentation(request.kind));
      let settled = false;
      const release = () => {
        if (settled) return false;
        settled = true;
        this.#active.delete(request.notificationId);
        return true;
      };
      notification.once("click", () => {
        if (!release()) return;
        try {
          notification?.close();
        } catch (error) {
          this.#options.onError?.(error);
        }
        void Promise.resolve(this.#options.activate({ ...request })).catch((error: unknown) => {
          this.#options.onError?.(error);
        });
      });
      notification.once("close", () => {
        release();
      });
      this.#active.set(request.notificationId, notification);
      notification.show();
      this.#remember(request.notificationId);
      return true;
    } catch (error) {
      this.#active.delete(request.notificationId);
      try {
        notification?.close();
      } catch {
        // The original notification error is the actionable failure.
      }
      this.#options.onError?.(error);
      return false;
    }
  }

  dismiss(notificationId: string): boolean {
    const notification = this.#active.get(notificationId);
    if (!notification) return false;
    this.#active.delete(notificationId);
    try {
      notification.close();
    } catch (error) {
      this.#options.onError?.(error);
    }
    return true;
  }

  dispose(): void {
    const notifications = [...this.#active.values()];
    this.#active.clear();
    for (const notification of notifications) {
      try {
        notification.close();
      } catch (error) {
        this.#options.onError?.(error);
      }
    }
  }

  #remember(notificationId: string): void {
    this.#dedupeIds.add(notificationId);
    this.#dedupeOrder.push(notificationId);
    while (this.#dedupeOrder.length > MAX_NATIVE_NOTIFICATION_DEDUPE_IDS) {
      const expired = this.#dedupeOrder.shift();
      if (expired) this.#dedupeIds.delete(expired);
    }
  }
}

function nativeNotificationPresentation(kind: NativeNotificationKind): {
  title: string;
  body: string;
} {
  switch (kind) {
    case "completed":
      return {
        title: "Pi 任务已完成",
        body: "后台会话已完成，可以返回 Pi-67 查看结果。"
      };
    case "failed":
      return {
        title: "Pi 任务失败",
        body: "后台会话未能完成，可以返回 Pi-67 查看详情并重试。"
      };
    case "attention":
      return {
        title: "Pi 任务需要处理",
        body: "后台会话正在等待你的确认或输入。"
      };
  }
  throw new Error(`Unsupported native notification kind: ${String(kind)}`);
}
