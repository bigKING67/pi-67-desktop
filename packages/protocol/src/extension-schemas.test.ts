import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ExtensionCompatibilitySchema,
  ExtensionUiCancelledSchema,
  ExtensionUiResolvedSchema,
  ExtensionUiRequestSchema,
  MAX_EXTENSION_COMPATIBILITY_DETAIL_LENGTH,
  MAX_EXTENSION_PACKAGE_LENGTH,
  MAX_EXTENSION_PATH_LENGTH,
  MAX_EXTENSION_UI_CANCELLED_REQUESTS,
  MAX_EXTENSION_UI_IDENTIFIER_LENGTH,
  MAX_EXTENSION_UI_KEY_LENGTH,
  MAX_EXTENSION_UI_MESSAGE_LENGTH,
  MAX_EXTENSION_UI_OPTION_LENGTH,
  MAX_EXTENSION_UI_OPTIONS,
  MAX_EXTENSION_UI_PLACEHOLDER_LENGTH,
  MAX_EXTENSION_UI_TITLE_LENGTH
} from "./extension-schemas.js";

describe("ExtensionUiRequestSchema", () => {
  it("accepts a representative bounded request", () => {
    expect(Value.Check(ExtensionUiRequestSchema, extensionRequest())).toBe(true);
  });

  it("accepts every field at its declared boundary", () => {
    expect(Value.Check(ExtensionUiRequestSchema, extensionRequest({
      requestId: text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH),
      extensionId: text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH),
      extensionPackage: text(MAX_EXTENSION_PACKAGE_LENGTH),
      extensionPath: text(MAX_EXTENSION_PATH_LENGTH),
      sessionId: text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH),
      operationId: text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH),
      title: text(MAX_EXTENSION_UI_TITLE_LENGTH),
      message: text(MAX_EXTENSION_UI_MESSAGE_LENGTH),
      placeholder: text(MAX_EXTENSION_UI_PLACEHOLDER_LENGTH),
      options: Array.from(
        { length: MAX_EXTENSION_UI_OPTIONS },
        () => text(MAX_EXTENSION_UI_OPTION_LENGTH)
      ),
      key: text(MAX_EXTENSION_UI_KEY_LENGTH)
    }))).toBe(true);
  });

  it.each([
    ["requestId", MAX_EXTENSION_UI_IDENTIFIER_LENGTH],
    ["extensionId", MAX_EXTENSION_UI_IDENTIFIER_LENGTH],
    ["extensionPackage", MAX_EXTENSION_PACKAGE_LENGTH],
    ["extensionPath", MAX_EXTENSION_PATH_LENGTH],
    ["sessionId", MAX_EXTENSION_UI_IDENTIFIER_LENGTH],
    ["operationId", MAX_EXTENSION_UI_IDENTIFIER_LENGTH],
    ["title", MAX_EXTENSION_UI_TITLE_LENGTH],
    ["message", MAX_EXTENSION_UI_MESSAGE_LENGTH],
    ["placeholder", MAX_EXTENSION_UI_PLACEHOLDER_LENGTH],
    ["key", MAX_EXTENSION_UI_KEY_LENGTH]
  ] as const)("rejects an overlong %s", (field, limit) => {
    expect(Value.Check(ExtensionUiRequestSchema, extensionRequest({
      [field]: text(limit + 1)
    }))).toBe(false);
  });

  it("rejects too many options and an overlong option", () => {
    expect(Value.Check(ExtensionUiRequestSchema, extensionRequest({
      options: Array.from({ length: MAX_EXTENSION_UI_OPTIONS + 1 }, () => "option")
    }))).toBe(false);
    expect(Value.Check(ExtensionUiRequestSchema, extensionRequest({
      options: [text(MAX_EXTENSION_UI_OPTION_LENGTH + 1)]
    }))).toBe(false);
  });

  it("rejects empty identifiers and unknown fields", () => {
    for (const field of ["requestId", "extensionId", "extensionPackage", "extensionPath", "sessionId", "operationId", "key"] as const) {
      expect(Value.Check(ExtensionUiRequestSchema, extensionRequest({ [field]: "" }))).toBe(false);
    }
    expect(Value.Check(ExtensionUiRequestSchema, {
      ...extensionRequest(),
      html: "<script>unsafe()</script>"
    })).toBe(false);
  });
});

describe("ExtensionUiCancelledSchema", () => {
  it("accepts the maximum bounded request ID list", () => {
    expect(Value.Check(ExtensionUiCancelledSchema, {
      requestIds: Array.from(
        { length: MAX_EXTENSION_UI_CANCELLED_REQUESTS },
        (_, index) => `${index}-${text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH - String(index).length - 1)}`
      ),
      reason: "connection-close"
    })).toBe(true);
    expect(Value.Check(ExtensionUiCancelledSchema, {
      requestIds: ["request-resync"],
      reason: "projection-resync"
    })).toBe(true);
  });

  it("rejects too many, empty, overlong, and unknown request ID fields", () => {
    expect(Value.Check(ExtensionUiCancelledSchema, {
      requestIds: Array.from({ length: MAX_EXTENSION_UI_CANCELLED_REQUESTS + 1 }, () => "request"),
      reason: "abort"
    })).toBe(false);
    expect(Value.Check(ExtensionUiCancelledSchema, { requestIds: [""], reason: "abort" })).toBe(false);
    expect(Value.Check(ExtensionUiCancelledSchema, {
      requestIds: [text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH + 1)],
      reason: "abort"
    })).toBe(false);
    expect(Value.Check(ExtensionUiCancelledSchema, {
      requestIds: ["request"],
      reason: "abort",
      unknown: true
    })).toBe(false);
  });
});

describe("ExtensionUiResolvedSchema", () => {
  it("accepts a bounded terminal receipt and rejects malformed fields", () => {
    expect(Value.Check(ExtensionUiResolvedSchema, {
      requestId: text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH),
      cancelled: false
    })).toBe(true);
    expect(Value.Check(ExtensionUiResolvedSchema, { requestId: "", cancelled: false })).toBe(false);
    expect(Value.Check(ExtensionUiResolvedSchema, {
      requestId: "request",
      cancelled: false,
      value: "must not cross the terminal event boundary"
    })).toBe(false);
  });
});

describe("ExtensionCompatibilitySchema", () => {
  it("accepts attribution and detail at their declared boundaries", () => {
    expect(Value.Check(ExtensionCompatibilitySchema, {
      extensionId: text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH),
      extensionPackage: text(MAX_EXTENSION_PACKAGE_LENGTH),
      extensionPath: text(MAX_EXTENSION_PATH_LENGTH),
      sessionId: text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH),
      sessionGeneration: 7,
      operationId: text(MAX_EXTENSION_UI_IDENTIFIER_LENGTH),
      hostEpoch: 9,
      status: "partial",
      detail: text(MAX_EXTENSION_COMPATIBILITY_DETAIL_LENGTH)
    })).toBe(true);
  });

  it.each([
    ["extensionId", MAX_EXTENSION_UI_IDENTIFIER_LENGTH],
    ["extensionPackage", MAX_EXTENSION_PACKAGE_LENGTH],
    ["extensionPath", MAX_EXTENSION_PATH_LENGTH],
    ["sessionId", MAX_EXTENSION_UI_IDENTIFIER_LENGTH],
    ["operationId", MAX_EXTENSION_UI_IDENTIFIER_LENGTH],
    ["detail", MAX_EXTENSION_COMPATIBILITY_DETAIL_LENGTH]
  ] as const)("rejects an overlong compatibility %s", (field, limit) => {
    expect(Value.Check(ExtensionCompatibilitySchema, {
      extensionId: "extension-1",
      status: "unsupported",
      detail: "unsupported feature",
      [field]: text(limit + 1)
    })).toBe(false);
  });

  it("rejects empty attribution and unknown compatibility fields", () => {
    for (const field of ["extensionId", "extensionPackage", "extensionPath", "sessionId", "operationId"] as const) {
      expect(Value.Check(ExtensionCompatibilitySchema, {
        [field]: "",
        status: "unsupported",
        detail: "unsupported feature"
      })).toBe(false);
    }
    expect(Value.Check(ExtensionCompatibilitySchema, {
      extensionId: "extension-1",
      status: "unsupported",
      detail: "unsupported feature",
      stack: "must not cross the protocol boundary"
    })).toBe(false);
  });
});

function extensionRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "extension-request-1",
    extensionId: "extension-1",
    extensionPackage: "example-extension",
    extensionPath: "/workspace/extensions/example.ts",
    sessionId: "session-1",
    sessionGeneration: 2,
    operationId: "operation-1",
    hostEpoch: 3,
    kind: "select",
    title: "Choose",
    message: "Select an option",
    placeholder: "Option",
    options: ["one", "two"],
    level: "info",
    key: "example-status",
    placement: "aboveEditor",
    blocking: true,
    ...overrides
  };
}

function text(length: number): string {
  return "x".repeat(length);
}
