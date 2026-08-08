import { describe, expect, it } from "vitest";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  isEnvelopeWithinByteLimit,
  isRequestEnvelope
} from "./envelope.js";

describe("protocol envelope limits", () => {
  it("accepts only bounded opaque attachment references across the Host boundary", () => {
    const submit = (attachments: Array<{ id: string }>) => commandEnvelope("prompt.submit", {
      submissionId: "submission-1",
      text: "inspect",
      delivery: "new-turn",
      attachments
    }, APP_PROTOCOL_CONTEXT, 1);
    expect(isRequestEnvelope(submit([
      { id: "attachment_123" }
    ]))).toBe(true);
    expect(isRequestEnvelope(submit(Array.from({ length: 21 }, (_, index) => ({
      id: `attachment_${index}`
    }))))).toBe(false);
    expect(isRequestEnvelope(submit([{ id: "../outside" }]))).toBe(false);
  });

  it("accepts only bounded opaque Workspace file references across the Host boundary", () => {
    const submit = (workspaceFiles: Array<{ id: string; revision: string }>) => commandEnvelope("prompt.submit", {
      submissionId: "submission-file-ref",
      text: "inspect @[src/main.ts]",
      delivery: "new-turn",
      workspaceFiles
    }, APP_PROTOCOL_CONTEXT, 1);
    expect(isRequestEnvelope(submit([{ id: "file_123", revision: "revision_123" }]))).toBe(true);
    expect(isRequestEnvelope(submit(Array.from({ length: 65 }, (_, index) => ({
      id: `file_${index}`,
      revision: `revision_${index}`
    }))))).toBe(false);
    expect(isRequestEnvelope(submit([{ id: "../outside", revision: "revision_123" }]))).toBe(false);
    expect(isRequestEnvelope(submit([{ id: "file_123", revision: "stale/revision" }]))).toBe(false);
  });

  it("enforces UTF-8 envelope bytes without charging transferred ArrayBuffer contents", () => {
    expect(isEnvelopeWithinByteLimit({ text: "中" }, 14)).toBe(true);
    expect(isEnvelopeWithinByteLimit({ text: "中" }, 13)).toBe(false);
    expect(isEnvelopeWithinByteLimit({ data: new ArrayBuffer(10 * 1024 * 1024) }, 11)).toBe(true);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(isEnvelopeWithinByteLimit(circular, 1_024)).toBe(false);

    const shared = { value: "counted twice" };
    const aliases = { first: shared, second: shared };
    const aliasBytes = new TextEncoder().encode(JSON.stringify(aliases)).byteLength;
    expect(isEnvelopeWithinByteLimit(aliases, aliasBytes)).toBe(true);
    expect(isEnvelopeWithinByteLimit(aliases, aliasBytes - 1)).toBe(false);
  });
});
