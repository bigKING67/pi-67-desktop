import type { AgentEvent } from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopExtensionUiBridge, DesktopUnsupportedUiError } from "./extension-ui-bridge.js";

describe("DesktopExtensionUiBridge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits blocking requests without inventing extension attribution", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));

    const result = bridge.context.select("Choose", ["one", "two"]);
    expect(events[0]).toEqual({
      type: "extension.ui.requested",
      payload: {
        requestId: expect.stringMatching(/^extension-ui-/),
        kind: "select",
        title: "Choose",
        options: ["one", "two"],
        blocking: true
      }
    });

    const request = events[0];
    if (request?.type !== "extension.ui.requested") throw new Error("Expected an extension UI request.");
    expect(bridge.resolve(request.payload.requestId, "two")).toBe(true);
    await expect(result).resolves.toBe("two");
    expect(events.at(-1)).toEqual({
      type: "extension.ui.resolved",
      payload: { requestId: request.payload.requestId, cancelled: false }
    });
    expect(bridge.resolve(request.payload.requestId, "one")).toBe(false);
  });

  it("includes only context values supplied by an authoritative owner", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge(
      (event) => events.push(event),
      () => ({ sessionId: "session-1", extensionPackage: "example-extension" })
    );

    const result = bridge.context.input("Value", "Type here");
    const request = events[0];
    expect(request).toMatchObject({
      type: "extension.ui.requested",
      payload: {
        sessionId: "session-1",
        extensionPackage: "example-extension"
      }
    });
    if (request?.type !== "extension.ui.requested") throw new Error("Expected an extension UI request.");
    expect(request.payload).not.toHaveProperty("extensionId");
    expect(request.payload).not.toHaveProperty("hostEpoch");
    bridge.resolve(request.payload.requestId, undefined, true);
    await expect(result).resolves.toBeUndefined();
    expect(events.at(-1)).toEqual({
      type: "extension.ui.resolved",
      payload: { requestId: request.payload.requestId, cancelled: true }
    });
  });

  it("cancels all pending requests once and reports the lifecycle reason", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const first = bridge.context.input("First");
    const second = bridge.context.editor("Second");
    const requestIds = events.flatMap((event) =>
      event.type === "extension.ui.requested" ? [event.payload.requestId] : []
    );

    expect(bridge.cancelAll("session-transition")).toEqual(requestIds);
    expect(bridge.cancelAll("session-transition")).toEqual([]);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(events.at(-1)).toEqual({
      type: "extension.ui.cancelled",
      payload: { requestIds, reason: "session-transition" }
    });
  });

  it("cancels a timed-out request and removes its abort listener", async () => {
    vi.useFakeTimers();
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const controller = new AbortController();
    const result = bridge.context.input("Value", undefined, { timeout: 1_000, signal: controller.signal });

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      type: "extension.ui.cancelled",
      payload: { reason: "timeout" }
    });
    controller.abort();
    expect(events.filter((event) => event.type === "extension.ui.cancelled")).toHaveLength(1);
  });

  it("keeps safety approvals separate and resolves only the matching tool call once", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const result = bridge.requestApproval(approvalDetails("tool-call-1"));
    const request = events[0];

    expect(request).toMatchObject({
      type: "approval.requested",
      payload: {
        requestId: expect.stringMatching(/^approval-ui-/),
        toolCallId: "tool-call-1",
        scope: "single-tool-call"
      }
    });
    expect(events.some((event) => event.type === "extension.ui.requested")).toBe(false);
    if (request?.type !== "approval.requested") throw new Error("Expected a safety approval request.");
    expect(bridge.resolveApproval(request.payload.requestId, "wrong-tool-call", true)).toBe(false);
    expect(bridge.resolveApproval(request.payload.requestId, "tool-call-1", true)).toBe(true);
    expect(bridge.resolveApproval(request.payload.requestId, "tool-call-1", true)).toBe(false);
    await expect(result).resolves.toBe(true);
    expect(events.at(-1)).toEqual({
      type: "approval.resolved",
      payload: { requestId: request.payload.requestId, toolCallId: "tool-call-1", allowed: true }
    });
  });

  it("fails an already-aborted approval without emitting or retaining a request", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const controller = new AbortController();
    controller.abort();

    await expect(bridge.requestApproval(approvalDetails("tool-call-aborted"), {
      signal: controller.signal
    })).resolves.toBe(false);
    expect(events).toEqual([]);
    expect(bridge.cancelAll("connection-close")).toEqual([]);
  });

  it("cancels pending approvals fail-closed when the connection closes", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const result = bridge.requestApproval(approvalDetails("tool-call-disconnected"));
    const request = events[0];
    if (request?.type !== "approval.requested") throw new Error("Expected a safety approval request.");

    expect(bridge.cancelAll("connection-close")).toEqual([request.payload.requestId]);
    await expect(result).resolves.toBe(false);
    expect(events.at(-1)).toEqual({
      type: "approval.cancelled",
      payload: {
        requests: [{ requestId: request.payload.requestId, toolCallId: "tool-call-disconnected" }],
        reason: "connection-close"
      }
    });
  });

  it("separates extension and approval request IDs when mixed requests are cancelled", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const extensionResult = bridge.context.input("Extension input");
    const approvalResult = bridge.requestApproval(approvalDetails("tool-call-mixed"));
    const extensionRequest = events.find((event) => event.type === "extension.ui.requested");
    const approvalRequest = events.find((event) => event.type === "approval.requested");
    if (extensionRequest?.type !== "extension.ui.requested" || approvalRequest?.type !== "approval.requested") {
      throw new Error("Expected one request of each interactive purpose.");
    }

    expect(bridge.cancelAll("connection-close")).toEqual([
      extensionRequest.payload.requestId,
      approvalRequest.payload.requestId
    ]);
    await expect(extensionResult).resolves.toBeUndefined();
    await expect(approvalResult).resolves.toBe(false);
    expect(events).toContainEqual({
      type: "extension.ui.cancelled",
      payload: { requestIds: [extensionRequest.payload.requestId], reason: "connection-close" }
    });
    expect(events).toContainEqual({
      type: "approval.cancelled",
      payload: {
        requests: [{ requestId: approvalRequest.payload.requestId, toolCallId: "tool-call-mixed" }],
        reason: "connection-close"
      }
    });
    expect(events.some((event) => event.type === "approval.resolved")).toBe(false);
    expect(bridge.cancelAll("connection-close")).toEqual([]);
  });

  it("emits approval cancellation rather than resolution when its signal aborts", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));
    const controller = new AbortController();
    const result = bridge.requestApproval(approvalDetails("tool-call-abort"), { signal: controller.signal });
    const request = events[0];
    if (request?.type !== "approval.requested") throw new Error("Expected a safety approval request.");

    controller.abort();
    await expect(result).resolves.toBe(false);
    expect(events.at(-1)).toEqual({
      type: "approval.cancelled",
      payload: {
        requests: [{ requestId: request.payload.requestId, toolCallId: "tool-call-abort" }],
        reason: "abort"
      }
    });
    expect(bridge.resolveApproval(request.payload.requestId, "tool-call-abort", true)).toBe(false);
    expect(events.some((event) => event.type === "approval.resolved")).toBe(false);
  });

  it("reports TUI-only features without using the feature as an extension identity", async () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));

    await expect(bridge.context.custom(() => {
      throw new Error("The TUI component factory must not run in Desktop.");
    })).rejects.toBeInstanceOf(DesktopUnsupportedUiError);
    const compatibility = events.find((event) => event.type === "extension.compatibilityChanged");
    expect(compatibility).toMatchObject({
      type: "extension.compatibilityChanged",
      payload: {
        status: "tui-only",
        detail: expect.stringContaining("custom:")
      }
    });
    if (compatibility?.type !== "extension.compatibilityChanged") {
      throw new Error("Expected an extension compatibility event.");
    }
    expect(compatibility.payload).not.toHaveProperty("extensionId");
    expect(JSON.stringify(events)).not.toContain("pi-extension");
  });

  it("reports unsupported working and editor mutations once without emitting orphaned UI updates", () => {
    const events: AgentEvent[] = [];
    const bridge = new DesktopExtensionUiBridge((event) => events.push(event));

    bridge.context.setWorkingMessage("Scanning");
    bridge.context.setWorkingVisible(true);
    bridge.context.setWorkingIndicator({ frames: [".", ".."] });
    bridge.context.pasteToEditor("first");
    bridge.context.setEditorText("second");

    expect(events.filter((event) => event.type === "extension.compatibilityChanged")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ status: "tui-only", detail: expect.stringContaining("working-indicator") })
      }),
      expect.objectContaining({
        payload: expect.objectContaining({ status: "tui-only", detail: expect.stringContaining("editor-mutation") })
      })
    ]);
    expect(events.some((event) => event.type === "extension.ui.updated")).toBe(false);
    expect(bridge.context.getEditorText()).toBe("second");
  });
});

function approvalDetails(toolCallId: string) {
  return {
    toolCallId,
    toolName: "bash",
    category: "ambiguous-command" as const,
    reason: "执行无法安全分类的命令",
    targetKind: "command" as const,
    target: "git status --short",
    targetTruncated: false,
    cwd: "/workspace",
    cwdTruncated: false,
    scope: "single-tool-call" as const
  };
}
