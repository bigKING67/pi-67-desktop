import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFER_IMAGE_BYTES,
  MAX_TRANSFER_IMAGE_COUNT,
  MAX_TRANSFER_IMAGE_TOTAL_BYTES
} from "./agent-messages.js";
import {
  commandEnvelope,
  isEnvelopeWithinByteLimit,
  isRequestEnvelope
} from "./envelope.js";

describe("protocol envelope limits", () => {
  it("rejects image payloads that cannot safely cross the Host boundary", () => {
    const submit = (images: Array<{ name: string; mimeType: string; data: ArrayBuffer }>) => commandEnvelope("prompt.submit", {
      submissionId: "submission-1",
      text: "inspect",
      delivery: "new-turn",
      images
    }, 1);
    expect(isRequestEnvelope(submit([
      { name: "screen.png", mimeType: "image/png", data: new ArrayBuffer(32) }
    ]))).toBe(true);

    const typedArray = submit([{ name: "screen.png", mimeType: "image/png", data: new ArrayBuffer(32) }]);
    (typedArray.payload.images![0] as { data: unknown }).data = new Uint8Array(32);
    expect(isRequestEnvelope(typedArray)).toBe(false);
    expect(isRequestEnvelope(submit([
      { name: "vector.svg", mimeType: "image/svg+xml", data: new ArrayBuffer(32) }
    ]))).toBe(false);
    expect(isRequestEnvelope(submit([
      { name: "large.png", mimeType: "image/png", data: new ArrayBuffer(MAX_TRANSFER_IMAGE_BYTES + 1) }
    ]))).toBe(false);
    expect(isRequestEnvelope(submit(Array.from({ length: MAX_TRANSFER_IMAGE_COUNT + 1 }, (_, index) => ({
      name: `${index}.png`, mimeType: "image/png", data: new ArrayBuffer(1)
    }))))).toBe(false);

    const perImageBytes = Math.floor(MAX_TRANSFER_IMAGE_TOTAL_BYTES / 4) + 1;
    expect(isRequestEnvelope(submit(Array.from({ length: 4 }, (_, index) => ({
      name: `${index}.png`, mimeType: "image/png", data: new ArrayBuffer(perImageBytes)
    }))))).toBe(false);
  });

  it("enforces UTF-8 envelope bytes without charging transferred ArrayBuffer contents", () => {
    expect(isEnvelopeWithinByteLimit({ text: "中" }, 14)).toBe(true);
    expect(isEnvelopeWithinByteLimit({ text: "中" }, 13)).toBe(false);
    expect(isEnvelopeWithinByteLimit({ data: new ArrayBuffer(10 * 1024 * 1024) }, 11)).toBe(true);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(isEnvelopeWithinByteLimit(circular, 1_024)).toBe(false);
  });
});
