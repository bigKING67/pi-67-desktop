import { describe, expect, it } from "vitest";
import { RuntimeError } from "@pi67/domain";
import { HostCommandError, toProtocolError } from "./protocol-error.js";

describe("toProtocolError", () => {
  it("redacts common secret shapes from messages and structured details", () => {
    const error = new HostCommandError(
      "INTERNAL",
      "apiKey=plain-secret Bearer bearer-secret https://user:url-secret@example.test "
        + "abcdefghijk.abcdefghijkl.mnopqrstuvw sk-provider-secret",
      true,
      {
        token: "detail-secret",
        endpoint: "https://user:detail-password@example.test",
        attempt: 2
      }
    );

    const protocolError = toProtocolError(error);
    const serialized = JSON.stringify(protocolError);
    for (const secret of [
      "plain-secret",
      "bearer-secret",
      "url-secret",
      "abcdefghijk",
      "provider-secret",
      "detail-secret",
      "detail-password"
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(protocolError.details).toEqual({
      token: "[redacted]",
      endpoint: "https://user:[redacted]@example.test",
      attempt: 2
    });
  });

  it("does not stringify unknown thrown values", () => {
    expect(toProtocolError({ password: "must-not-cross" })).toEqual({
      code: "INTERNAL",
      message: "Unknown Pi runtime service error.",
      recoverable: true
    });
  });

  it("maps only explicitly structured runtime errors", () => {
    expect(toProtocolError(new RuntimeError(
      "SESSION_CHANGED_EXTERNALLY",
      "The session changed.",
      { details: { retryable: true } }
    ))).toEqual({
      code: "SESSION_CHANGED_EXTERNALLY",
      message: "The session changed.",
      recoverable: true,
      details: { retryable: true }
    });

    for (const message of [
      "The Pi session changed outside Desktop.",
      "Pi SDK runtime is not initialized.",
      "Unknown Pi model: provider/model"
    ]) {
      expect(toProtocolError(new Error(message))).toMatchObject({ code: "INTERNAL" });
    }
  });

  it("maps session import limits without exposing source paths or content", () => {
    const protocolError = toProtocolError(new RuntimeError(
      "RESOURCE_LIMIT_EXCEEDED",
      "The selected Pi session file exceeds the import limit.",
      {
        details: {
          resource: "session-import",
          limitCode: "SESSION_IMPORT_FILE_TOO_LARGE",
          limitBytes: 268_435_456
        }
      }
    ));
    expect(protocolError).toEqual({
      code: "RESOURCE_LIMIT_EXCEEDED",
      message: "The selected Pi session file exceeds the import limit.",
      recoverable: true,
      details: {
        resource: "session-import",
        limitCode: "SESSION_IMPORT_FILE_TOO_LARGE",
        limitBytes: 268_435_456
      }
    });
    expect(JSON.stringify(protocolError)).not.toMatch(/source-prefix|\/Users\/|\.jsonl/iu);
  });
});
