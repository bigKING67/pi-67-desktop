import { describe, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";
import { requestWithBoundedTransportRetry } from "./bounded-transport-retry.js";

describe("requestWithBoundedTransportRetry", () => {
  it("retries one transport failure after the caller prepares a safe replay", async () => {
    const execute = vi.fn(async (attempt: number) => {
      if (attempt === 0) throw transportError();
      return "accepted";
    });
    const prepareRetry = vi.fn(async () => true);

    await expect(requestWithBoundedTransportRetry(execute, prepareRetry)).resolves.toBe("accepted");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(prepareRetry).toHaveBeenCalledOnce();
  });

  it("does not replay when the caller reports that Host authority changed", async () => {
    const error = transportError();
    const execute = vi.fn(async () => { throw error; });

    await expect(requestWithBoundedTransportRetry(execute, async () => false)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not retry structured runtime failures", async () => {
    const error = new ProtocolRequestError({
      code: "BUSY",
      message: "another operation is active",
      recoverable: true
    });
    const execute = vi.fn(async () => { throw error; });

    await expect(requestWithBoundedTransportRetry(execute)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not replay an acknowledgement that timed out on an open connection", async () => {
    const error = new ProtocolRequestError({
      code: "REQUEST_TIMEOUT",
      message: "Agent request acknowledgement timed out.",
      recoverable: true
    });
    const execute = vi.fn(async () => { throw error; });
    const prepareRetry = vi.fn(async () => true);

    await expect(requestWithBoundedTransportRetry(execute, prepareRetry)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledOnce();
    expect(prepareRetry).not.toHaveBeenCalled();
  });
});

function transportError(): ProtocolRequestError {
  return new ProtocolRequestError({
    code: "CONNECTION_CLOSED",
    message: "Agent connection closed.",
    recoverable: true
  });
}
