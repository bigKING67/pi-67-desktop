import { describe, expect, it } from "vitest";
import { MAX_ASSET_READ_BYTES, MAX_RUNTIME_ASSET_BYTES } from "@pi67/domain";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope
} from "./envelope.js";

describe("asset protocol", () => {
  it("validates bounded generation-bound reads and transferred chunks", () => {
    const request = commandEnvelope("asset.read", {
      assetId: "asset-1",
      sessionGeneration: 3,
      offset: 0,
      length: MAX_ASSET_READ_BYTES
    }, APP_PROTOCOL_CONTEXT, 2);
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isRequestEnvelope({
      ...request,
      payload: { ...request.payload, offset: MAX_RUNTIME_ASSET_BYTES }
    })).toBe(false);
    expect(isRequestEnvelope({
      ...request,
      payload: { ...request.payload, length: MAX_ASSET_READ_BYTES + 1 }
    })).toBe(false);

    const validResult = {
      assetId: "asset-1",
      mimeType: "image/png",
      byteLength: 3,
      offset: 0,
      data: new ArrayBuffer(3),
      done: true
    } as const;
    const validResponse = responseEnvelope(request.requestId, 2, request.context, {
      ok: true,
      type: "asset.read",
      result: validResult
    });
    expect(isResponseEnvelope(validResponse)).toBe(true);
    expect(isResponseEnvelope({
      ...validResponse,
      result: { ...validResult, data: new Uint8Array(3) }
    })).toBe(false);
    expect(isResponseEnvelope({
      ...validResponse,
      result: {
        ...validResult,
        byteLength: MAX_ASSET_READ_BYTES + 2,
        data: new ArrayBuffer(MAX_ASSET_READ_BYTES + 1),
        done: false
      }
    })).toBe(false);
    expect(isResponseEnvelope({
      ...validResponse,
      result: { ...validResult, done: false }
    })).toBe(false);
    expect(isResponseEnvelope({
      ...validResponse,
      result: { ...validResult, offset: 2 }
    })).toBe(false);
  });
});
