import type { AppState } from "../app/app-store.types.js";
import { publishNotification } from "../notifications/notification-store.js";
import { messages } from "../localization/message-catalog.js";

type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function reportSessionError(error: unknown, set: StoreSet, title: string): void {
  const detail = sessionErrorMessage(error);
  publishNotification({ level: "error", title, message: detail });
  set({ runtime: { phase: "failed", detail: `${title}：${detail}`, recoverable: true } });
}

export function sessionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.runtime.unknownError;
}
