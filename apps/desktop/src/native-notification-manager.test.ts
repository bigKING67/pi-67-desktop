import type { NativeNotificationRequest } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  NativeNotificationManager,
  type NativeNotificationHandle
} from "./native-notification-manager.js";

describe("native notification manager", () => {
  it("shows privacy-bounded product copy and activates the exact Session identity", async () => {
    const notifications: FakeNotification[] = [];
    const activate = vi.fn().mockResolvedValue(undefined);
    const manager = new NativeNotificationManager({
      isSupported: () => true,
      create: (presentation) => {
        const notification = new FakeNotification(presentation);
        notifications.push(notification);
        return notification;
      },
      activate
    });

    expect(manager.show(request())).toBe(true);
    expect(notifications[0]).toMatchObject({
      presentation: {
        title: "Pi 任务已完成",
        body: "后台会话已完成，可以返回 Pi-67 查看结果。"
      },
      shown: true
    });

    notifications[0]!.emit("click");
    await Promise.resolve();

    expect(activate).toHaveBeenCalledWith(request());
    expect(notifications[0]?.closed).toBe(true);
  });

  it("deduplicates a terminal event even after its notification closes", () => {
    const notifications: FakeNotification[] = [];
    const manager = managerWith(notifications);

    expect(manager.show(request())).toBe(true);
    notifications[0]!.emit("close");
    expect(manager.show(request())).toBe(false);
    expect(notifications).toHaveLength(1);
  });

  it("dismisses an active notification without activating its Session", () => {
    const notifications: FakeNotification[] = [];
    const activate = vi.fn();
    const manager = managerWith(notifications, activate);

    manager.show(request());

    expect(manager.dismiss(request().notificationId)).toBe(true);
    expect(notifications[0]?.closed).toBe(true);
    expect(activate).not.toHaveBeenCalled();
    expect(manager.dismiss(request().notificationId)).toBe(false);
  });

  it("does not construct notifications when the platform does not support them", () => {
    const create = vi.fn();
    const manager = new NativeNotificationManager({
      isSupported: () => false,
      create,
      activate: vi.fn()
    });

    expect(manager.show(request())).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

class FakeNotification implements NativeNotificationHandle {
  readonly presentation: { title: string; body: string };
  readonly #listeners = new Map<"click" | "close", () => void>();
  shown = false;
  closed = false;

  constructor(presentation: { title: string; body: string }) {
    this.presentation = presentation;
  }

  once(event: "click" | "close", listener: () => void): void {
    this.#listeners.set(event, listener);
  }

  show(): void {
    this.shown = true;
  }

  close(): void {
    this.closed = true;
  }

  emit(event: "click" | "close"): void {
    const listener = this.#listeners.get(event);
    this.#listeners.delete(event);
    listener?.();
  }
}

function managerWith(
  notifications: FakeNotification[],
  activate = vi.fn()
): NativeNotificationManager {
  return new NativeNotificationManager({
    isSupported: () => true,
    create: (presentation) => {
      const notification = new FakeNotification(presentation);
      notifications.push(notification);
      return notification;
    },
    activate
  });
}

function request(): NativeNotificationRequest {
  return {
    notificationId: "native:9:operation-1:completed",
    kind: "completed",
    workspaceId: "workspace-1",
    sessionFileIdentity: "session-file-1"
  };
}
