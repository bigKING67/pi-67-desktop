import { describe, expect, it } from "vitest";
import {
  isDesktopAgentHostFailureState,
  isDesktopAgentHostStartupState,
  isNativeNotificationRequest,
  isShutdownCheckpointRequest,
  isShutdownCheckpointResponse,
  isWorkspaceEntryRequest,
  isWorkspaceId
} from "./desktop-bridge-messages.js";

describe("desktop system-bridge message shapes", () => {
  it("bounds workspace identifiers", () => {
    expect(isWorkspaceId("workspace-1:a.b")).toBe(true);
    for (const value of ["", "a/b", "a b", "x".repeat(201), 1]) expect(isWorkspaceId(value), String(value)).toBe(false);
  });

  it("accepts only exact native notification requests", () => {
    const request = { notificationId: "n-1", kind: "completed", workspaceId: "w-1", sessionFileIdentity: "file-1" };
    expect(isNativeNotificationRequest(request)).toBe(true);
    expect(isNativeNotificationRequest({ ...request, kind: "info" })).toBe(false);
    expect(isNativeNotificationRequest({ ...request, notificationId: "bad id" })).toBe(false);
    expect(isNativeNotificationRequest({ ...request, extra: true })).toBe(false);
    const chat = { notificationId: "chat-c1-1", kind: "chat", title: "李雷 在 #设计 提到了你", body: "", conversationId: "c-1", messageSeq: 4 };
    expect(isNativeNotificationRequest(chat)).toBe(true);
    expect(isNativeNotificationRequest({ ...chat, title: "" })).toBe(false);
    expect(isNativeNotificationRequest({ ...chat, body: "x".repeat(241) })).toBe(false);
    expect(isNativeNotificationRequest({ ...chat, workspaceId: "w-1" })).toBe(false);
    expect(isNativeNotificationRequest({ ...request, kind: "chat" })).toBe(false);
  });

  it("owns the workspace entry and shutdown checkpoint shapes", () => {
    expect(isWorkspaceEntryRequest({ workspaceId: "w-1", relativePath: "src/a.ts", kind: "file" })).toBe(true);
    expect(isWorkspaceEntryRequest({ workspaceId: "w-1", relativePath: "src/a.ts", kind: "socket" })).toBe(false);
    expect(isShutdownCheckpointRequest({ requestId: "r-1" })).toBe(true);
    expect(isShutdownCheckpointRequest({ requestId: "r-1", extra: 1 })).toBe(false);
    expect(isShutdownCheckpointResponse({ requestId: "r-1", succeeded: true })).toBe(true);
    expect(isShutdownCheckpointResponse({ requestId: "", succeeded: true })).toBe(false);
  });

  it("validates Main to renderer Agent Host state events", () => {
    expect(isDesktopAgentHostFailureState({ code: 1, recoverable: true, attempt: 2 })).toBe(true);
    expect(isDesktopAgentHostFailureState({ code: -1073741819, recoverable: false, hostEpoch: 3 })).toBe(true);
    expect(isDesktopAgentHostFailureState({ code: 1.5, recoverable: false })).toBe(false);
    expect(isDesktopAgentHostFailureState({ code: 1, recoverable: false, stack: "at x" })).toBe(false);
    expect(isDesktopAgentHostStartupState({ hostEpoch: 1, startup: {} })).toBe(false);
  });
});
