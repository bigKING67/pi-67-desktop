import { describe, expect, it } from "vitest";
import {
  asExternalUrl,
  asNativeNotificationId,
  asNativeNotificationRequest,
  assertWorkspaceId,
  assertWorkspaceIds
} from "./system-bridge-policy.js";

describe("system bridge input policy", () => {
  it("accepts only bounded opaque native notification identities", () => {
    expect(asNativeNotificationRequest({
      notificationId: "native:9:operation-1:completed",
      kind: "completed",
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-1"
    })).toEqual({
      notificationId: "native:9:operation-1:completed",
      kind: "completed",
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-1"
    });
    expect(asNativeNotificationRequest({
      notificationId: "native:9:operation-1:completed",
      kind: "completed",
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-1",
      title: "renderer-controlled text is not accepted"
    })).toBeUndefined();
    expect(asNativeNotificationRequest({
      notificationId: "native/invalid",
      kind: "completed",
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-1"
    })).toBeUndefined();
    expect(asNativeNotificationRequest("invalid")).toBeUndefined();
    expect(asNativeNotificationId("native:9:operation-1:completed")).toBe(
      "native:9:operation-1:completed"
    );
    expect(asNativeNotificationId("native/invalid")).toBeUndefined();
  });

  it("accepts only valid HTTP and HTTPS external URLs", () => {
    expect(asExternalUrl("https://example.invalid/path")?.href).toBe("https://example.invalid/path");
    expect(asExternalUrl("http://example.invalid/")?.href).toBe("http://example.invalid/");
    expect(asExternalUrl("https://user@example.invalid/private")).toBeUndefined();
    expect(asExternalUrl("https://user:password@example.invalid/private")).toBeUndefined();
    expect(asExternalUrl(`https://example.invalid/${"x".repeat(2_048)}`)).toBeUndefined();
    expect(asExternalUrl("file:///tmp/private")).toBeUndefined();
    expect(asExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(asExternalUrl("not a URL")).toBeUndefined();
    expect(asExternalUrl({ href: "https://example.invalid" })).toBeUndefined();
  });

  it("rejects malformed native notification fields at the Main boundary", () => {
    const valid = {
      notificationId: "native:1:operation:completed",
      kind: "completed",
      workspaceId: "workspace-1",
      sessionFileIdentity: "session-file-1"
    };
    expect(asNativeNotificationRequest({ ...valid, kind: "unknown" })).toBeUndefined();
    expect(asNativeNotificationRequest({ ...valid, workspaceId: 1 })).toBeUndefined();
    expect(asNativeNotificationRequest({ ...valid, workspaceId: "" })).toBeUndefined();
    expect(asNativeNotificationRequest({ ...valid, workspaceId: "w".repeat(201) })).toBeUndefined();
    expect(asNativeNotificationRequest({ ...valid, workspaceId: "workspace/invalid" })).toBeUndefined();
    expect(asNativeNotificationRequest({ ...valid, sessionFileIdentity: 1 })).toBeUndefined();
    expect(asNativeNotificationRequest({ ...valid, sessionFileIdentity: "" })).toBeUndefined();
    expect(asNativeNotificationRequest({
      ...valid,
      sessionFileIdentity: "s".repeat(2_049)
    })).toBeUndefined();
  });

  it("accepts only bounded Workspace identities and order arrays", () => {
    expect(assertWorkspaceId("workspace-1")).toBe("workspace-1");
    expect(() => assertWorkspaceId(1)).toThrow("Workspace id is invalid");
    expect(() => assertWorkspaceId("")).toThrow("Workspace id is invalid");
    expect(() => assertWorkspaceId("w".repeat(201))).toThrow("Workspace id is invalid");
    expect(() => assertWorkspaceId("workspace/invalid")).toThrow("Workspace id is invalid");
    expect(assertWorkspaceIds(["workspace-1", "workspace-2"])).toEqual(["workspace-1", "workspace-2"]);
    expect(() => assertWorkspaceIds("workspace-1")).toThrow("Workspace order is invalid");
    expect(() => assertWorkspaceIds(Array.from({ length: 101 }, (_, index) => `workspace-${index}`)))
      .toThrow("Workspace order is invalid");
  });
});
