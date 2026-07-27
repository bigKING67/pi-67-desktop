import { describe, expect, it } from "vitest";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

describe("sanitizeRuntimeText", () => {
  it("redacts common secret shapes and enforces an output boundary", () => {
    const sanitized = sanitizeRuntimeText(
      "token=plain-secret Bearer bearer-secret https://user:url-secret@example.test "
        + "abcdefghijk.abcdefghijkl.mnopqrstuvw sk-provider-secret "
        + "x".repeat(1_000),
      256
    );

    for (const secret of ["plain-secret", "bearer-secret", "url-secret", "abcdefghijk", "provider-secret"]) {
      expect(sanitized).not.toContain(secret);
    }
    expect(sanitized.length).toBeLessThanOrEqual(256);
  });
});
