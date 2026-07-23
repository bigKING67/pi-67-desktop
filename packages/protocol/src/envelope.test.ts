import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFER_IMAGE_BYTES,
  MAX_TRANSFER_IMAGE_COUNT,
  MAX_TRANSFER_IMAGE_TOTAL_BYTES
} from "./agent-messages.js";
import { commandEnvelope, eventEnvelope, isCommandEnvelope, isEventEnvelope } from "./envelope.js";

describe("protocol envelopes", () => {
  it("validates commands and events", () => {
    const command = commandEnvelope("runtime.getStatus", {});
    const event = eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "Pi SDK ready",
      recoverable: true
    });
    expect(isCommandEnvelope(command)).toBe(true);
    expect(isEventEnvelope(event)).toBe(true);
  });

  it("rejects an unknown command", () => {
    const value = {
      protocolVersion: 1,
      kind: "command",
      messageId: "m",
      requestId: "r",
      timestamp: Date.now(),
      command: { type: "provider.codex", payload: {} }
    };
    expect(isCommandEnvelope(value)).toBe(false);
  });

  it("rejects a known command with an invalid payload", () => {
    const command = commandEnvelope("session.open", { path: "/tmp/session.jsonl" });
    const malformed = { ...command, command: { type: "session.open", payload: { path: 42 } } };
    expect(isCommandEnvelope(malformed)).toBe(false);
  });

  it("rejects image payloads that cannot safely cross the Agent Host boundary", () => {
    const valid = commandEnvelope("prompt.send", {
      text: "inspect",
      images: [{ name: "screen.png", mimeType: "image/png", data: new ArrayBuffer(32) }]
    });
    expect(isCommandEnvelope(valid)).toBe(true);

    const typedArray = commandEnvelope("prompt.send", {
      text: "inspect",
      images: [{ name: "screen.png", mimeType: "image/png", data: new ArrayBuffer(32) }]
    });
    (typedArray.command.payload as { images: Array<{ data: unknown }> }).images[0]!.data = new Uint8Array(32);
    expect(isCommandEnvelope(typedArray)).toBe(false);

    const unsupportedMime = commandEnvelope("prompt.send", {
      text: "inspect",
      images: [{ name: "vector.svg", mimeType: "image/svg+xml", data: new ArrayBuffer(32) }]
    });
    expect(isCommandEnvelope(unsupportedMime)).toBe(false);

    const oversized = commandEnvelope("prompt.send", {
      text: "inspect",
      images: [{ name: "large.png", mimeType: "image/png", data: new ArrayBuffer(MAX_TRANSFER_IMAGE_BYTES + 1) }]
    });
    expect(isCommandEnvelope(oversized)).toBe(false);

    const tooMany = commandEnvelope("prompt.send", {
      text: "inspect",
      images: Array.from({ length: MAX_TRANSFER_IMAGE_COUNT + 1 }, (_, index) => ({
        name: `${index}.png`,
        mimeType: "image/png",
        data: new ArrayBuffer(1)
      }))
    });
    expect(isCommandEnvelope(tooMany)).toBe(false);

    const perImageBytes = Math.floor(MAX_TRANSFER_IMAGE_TOTAL_BYTES / 4) + 1;
    const excessiveTotal = commandEnvelope("prompt.send", {
      text: "inspect",
      images: Array.from({ length: 4 }, (_, index) => ({
        name: `${index}.png`,
        mimeType: "image/png",
        data: new ArrayBuffer(perImageBytes)
      }))
    });
    expect(isCommandEnvelope(excessiveTotal)).toBe(false);
  });
});
