import { describe, expect, it } from "vitest";
import { asExternalUrl, asNotification } from "./system-bridge-policy.js";

describe("system bridge input policy", () => {
  it("accepts only bounded notification text", () => {
    expect(asNotification({ title: "t".repeat(121), body: "b".repeat(501) })).toEqual({
      title: "t".repeat(120),
      body: "b".repeat(500)
    });
    expect(asNotification({ title: "valid" })).toBeUndefined();
    expect(asNotification("invalid")).toBeUndefined();
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
