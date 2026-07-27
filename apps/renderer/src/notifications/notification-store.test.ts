import type { OperationKind } from "@pi67/domain";
import type { OperationSettled } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_NOTIFICATION_DEDUPE_WINDOW_MS,
  MAX_NOTIFICATION_HISTORY,
  MAX_OPERATION_DEDUPE_KEYS,
  MAX_VISIBLE_TOASTS,
  recordOperationTerminal,
  useNotificationStore
} from "./notification-store.js";

describe("notification store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds in-memory history", () => {
    for (let index = 0; index < MAX_NOTIFICATION_HISTORY + 5; index += 1) {
      vi.setSystemTime(1_000 + index * (GENERIC_NOTIFICATION_DEDUPE_WINDOW_MS + 1));
      useNotificationStore.getState().publish({ level: "info", title: `通知 ${index}` });
    }

    const items = useNotificationStore.getState().items;
    expect(items).toHaveLength(MAX_NOTIFICATION_HISTORY);
    expect(items[0]?.title).toBe("通知 5");
  });

  it("bounds visible toasts independently from history", () => {
    for (let index = 0; index < MAX_VISIBLE_TOASTS + 3; index += 1) {
      useNotificationStore.getState().publish({ level: "info", title: `Toast ${index}` });
    }

    expect(useNotificationStore.getState().items).toHaveLength(MAX_VISIBLE_TOASTS + 3);
    expect(useNotificationStore.getState().toastIds).toHaveLength(MAX_VISIBLE_TOASTS);
  });

  it("deduplicates generic notifications only inside the five-second window", () => {
    const store = useNotificationStore.getState();
    store.publish({ level: "warning", title: "连接中断" });
    store.publish({ level: "warning", title: "连接中断" });
    expect(useNotificationStore.getState().items).toHaveLength(1);

    vi.advanceTimersByTime(GENERIC_NOTIFICATION_DEDUPE_WINDOW_MS + 1);
    useNotificationStore.getState().publish({ level: "warning", title: "连接中断" });
    expect(useNotificationStore.getState().items).toHaveLength(2);
  });

  it("deduplicates a terminal Operation by Host epoch and Operation ID", () => {
    recordOperationTerminal(terminalReceipt({ operationId: "operation-1", lifecycle: "completed" }));
    recordOperationTerminal(terminalReceipt({ operationId: "operation-1", lifecycle: "failed" }));

    expect(useNotificationStore.getState().items).toHaveLength(1);
    expect(useNotificationStore.getState().items[0]).toMatchObject({
      dedupeKey: "operation:9:operation-1",
      level: "success",
      title: "任务已完成"
    });
  });

  it("keeps equal Operation IDs from different Host epochs distinct", () => {
    recordOperationTerminal(terminalReceipt({ operationId: "operation-1", hostEpoch: 9 }));
    recordOperationTerminal(terminalReceipt({ operationId: "operation-1", hostEpoch: 10 }));

    expect(useNotificationStore.getState().items.map((item) => item.dedupeKey)).toEqual([
      "operation:9:operation-1",
      "operation:10:operation-1"
    ]);
  });

  it("keeps recent terminal dedupe keys after their visible history rows are evicted", () => {
    for (let index = 0; index < MAX_NOTIFICATION_HISTORY + 1; index += 1) {
      recordOperationTerminal(terminalReceipt({ operationId: `operation-${index}` }));
    }
    expect(useNotificationStore.getState().terminalDedupeKeys).toHaveLength(MAX_NOTIFICATION_HISTORY + 1);
    expect(useNotificationStore.getState().terminalDedupeKeys.length).toBeLessThanOrEqual(MAX_OPERATION_DEDUPE_KEYS);

    recordOperationTerminal(terminalReceipt({ operationId: "operation-0" }));

    expect(useNotificationStore.getState().items.at(-1)?.operation?.operationId).toBe("operation-50");
  });

  it("dismisses a toast without deleting its history", () => {
    useNotificationStore.getState().publish({ level: "info", title: "保留历史" });
    const id = useNotificationStore.getState().items[0]!.id;

    useNotificationStore.getState().dismissToast(id);

    expect(useNotificationStore.getState().toastIds).toEqual([]);
    expect(useNotificationStore.getState().items).toHaveLength(1);
  });

  it("marks all history as read", () => {
    useNotificationStore.getState().publish({ level: "info", title: "第一条" });
    useNotificationStore.getState().publish({ level: "warning", title: "第二条" });

    useNotificationStore.getState().markAllRead();

    expect(useNotificationStore.getState().items.every((item) => item.read)).toBe(true);
  });

  it("clears history and visible toasts together", () => {
    useNotificationStore.getState().publish({ level: "info", title: "待清空" });
    useNotificationStore.getState().clear();
    expect(useNotificationStore.getState()).toMatchObject({
      items: [],
      toastIds: [],
      terminalDedupeKeys: []
    });
  });

  it("stores bounded terminal metadata without raw error payloads or paths", () => {
    recordOperationTerminal(terminalReceipt({
      lifecycle: "failed",
      errorMessage: "Bearer secret-token failed in /Users/example/private/source.ts"
    }));

    const item = useNotificationStore.getState().items[0]!;
    expect(item.message).toBe("Pi 命令 · 错误代码 INTERNAL");
    expect(item.operation).toEqual({
      hostEpoch: 9,
      operationId: "operation-1",
      operationKind: "command",
      lifecycle: "failed",
      sessionId: "session-1",
      sessionGeneration: 3,
      startedAt: 10,
      settledAt: 20,
      errorCode: "INTERNAL"
    });
    expect(JSON.stringify(item)).not.toContain("secret-token");
    expect(JSON.stringify(item)).not.toContain("/Users/example");
  });

  it("redacts credentials, links, paths, and backtick details from generic history", () => {
    useNotificationStore.getState().publish({
      level: "error",
      title: "读取失败",
      message: "Bearer secret-token https://example.test/private /Users/example/source.ts `raw command`"
    });

    const serialized = JSON.stringify(useNotificationStore.getState().items[0]);
    expect(serialized).toContain("[凭据已隐藏]");
    expect(serialized).toContain("[链接已隐藏]");
    expect(serialized).toContain("[路径已隐藏]");
    expect(serialized).toContain("[详情已隐藏]");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("example.test");
    expect(serialized).not.toContain("/Users/example");
    expect(serialized).not.toContain("raw command");
  });

  it("presents completed, failed, cancelled, and lost terminal states distinctly", () => {
    for (const lifecycle of ["completed", "failed", "cancelled", "lost"] as const) {
      recordOperationTerminal(terminalReceipt({ operationId: `operation-${lifecycle}`, lifecycle }));
    }

    expect(useNotificationStore.getState().items.map(({ level, title }) => ({ level, title }))).toEqual([
      { level: "success", title: "任务已完成" },
      { level: "error", title: "任务失败" },
      { level: "info", title: "任务已停止" },
      { level: "warning", title: "任务已中断" }
    ]);
  });
});

function terminalReceipt(options: {
  operationId?: string;
  operationKind?: OperationKind;
  lifecycle?: OperationSettled["lifecycle"];
  hostEpoch?: number;
  errorMessage?: string;
} = {}): OperationSettled {
  const lifecycle = options.lifecycle ?? "completed";
  const base = {
    kind: "settled" as const,
    operationId: options.operationId ?? "operation-1",
    operationKind: options.operationKind ?? "command",
    cancellable: false as const,
    hostEpoch: options.hostEpoch ?? 9,
    sessionId: "session-1",
    sessionGeneration: 3,
    startedAt: 10,
    settledAt: 20
  };
  if (lifecycle === "failed") {
    return {
      ...base,
      lifecycle,
      error: { code: "INTERNAL", message: options.errorMessage ?? "Structured failure", recoverable: true }
    };
  }
  if (lifecycle === "cancelled" || lifecycle === "lost") {
    return { ...base, lifecycle, reason: lifecycle === "lost" ? "Runtime replaced" : "Cancelled" };
  }
  return { ...base, lifecycle };
}

function resetStore(): void {
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
}
