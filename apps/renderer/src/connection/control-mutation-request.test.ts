import { describe, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";
import { requestReplaySafeControlMutation } from "./control-mutation-request.js";

describe("requestReplaySafeControlMutation", () => {
  it("reuses one idempotency key for a bounded transport retry", async () => {
    const execute = vi.fn(async (idempotencyKey: string, attempt: number) => {
      if (attempt === 0) {
        throw new ProtocolRequestError({
          code: "CONNECTION_CLOSED",
          message: "acknowledgement timed out",
          recoverable: true
        });
      }
      return acknowledgement(idempotencyKey);
    });

    await expect(requestReplaySafeControlMutation("session.create", execute)).resolves.toMatchObject({
      accepted: true,
      sessionId: expect.stringMatching(/^control-session\.create-/),
      eventSequence: 3
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toBe(execute.mock.calls[1]?.[0]);
  });

  it("does not retry structured runtime failures", async () => {
    const error = new ProtocolRequestError({
      code: "BUSY",
      message: "another operation is active",
      recoverable: true
    });
    const execute = vi.fn(async () => {
      throw error;
    });

    await expect(requestReplaySafeControlMutation("resource.reload", execute)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledOnce();
  });
});

function acknowledgement(sessionId: string) {
  return {
    accepted: true as const,
    hostEpoch: 1,
    sessionId,
    sessionGeneration: 2,
    eventSequence: 3
  };
}
