import { describe, expect, it } from "vitest";
import {
  APP_PROTOCOL_CONTEXT,
  isRequestCancellationEnvelope,
  requestCancellationEnvelope
} from "./envelope.js";

describe("request cancellation envelope", () => {
  it("validates bounded cancellation frames without command authority", () => {
    const cancellation = requestCancellationEnvelope("request-cancellable", 7);

    expect(isRequestCancellationEnvelope(cancellation)).toBe(true);
    expect(isRequestCancellationEnvelope({ ...cancellation, requestId: "" })).toBe(false);
    expect(isRequestCancellationEnvelope({ ...cancellation, hostEpoch: -1 })).toBe(false);
    expect(isRequestCancellationEnvelope({
      ...cancellation,
      context: APP_PROTOCOL_CONTEXT
    })).toBe(false);
  });
});
