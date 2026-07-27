import { describe, expect, it } from "vitest";
import { RuntimeError, isRuntimeError } from "./runtime-error.js";

describe("RuntimeError", () => {
  it("carries a dependency-free structured error contract", () => {
    const error = new RuntimeError("BUSY", "Runtime transition is busy.", {
      recoverable: true,
      details: { retryable: true }
    });

    expect(isRuntimeError(error)).toBe(true);
    expect(error).toMatchObject({
      name: "RuntimeError",
      code: "BUSY",
      recoverable: true,
      details: { retryable: true }
    });
  });

  it("does not trust an arbitrary error with a code property", () => {
    const spoofed = Object.assign(new Error("spoofed"), {
      code: "RUNTIME_NOT_READY",
      recoverable: true
    });
    expect(isRuntimeError(spoofed)).toBe(false);
  });

  it("recognizes stale Session Catalog cursors as a structured runtime error", () => {
    const error = new RuntimeError("STALE_SESSION_CATALOG", "Session Catalog cursor is stale.", {
      details: { cursorRevision: 2, currentRevision: 3 }
    });

    expect(isRuntimeError(error)).toBe(true);
    expect(error.code).toBe("STALE_SESSION_CATALOG");
  });
});
