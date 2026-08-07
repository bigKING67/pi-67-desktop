import { describe, expect, it } from "vitest";
import {
  asExternalUrl,
  asNativeNotificationId,
  asNativeNotificationRequest
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
});
