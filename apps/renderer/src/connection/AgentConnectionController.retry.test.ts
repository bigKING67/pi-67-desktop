import { describe, expect, it, vi } from "vitest";
import { prepareSameHostTransportRetry } from "./AgentConnectionController.js";
import { connectionIdentity } from "./AgentConnectionController.test-fixture.js";

describe("prepareSameHostTransportRetry", () => {
  it("allows one retry after reconnecting to the same Host epoch", async () => {
    const waitForConnection = vi.fn(async () => connectionIdentity(4));

    await expect(prepareSameHostTransportRetry(4, waitForConnection)).resolves.toBe(true);
    expect(waitForConnection).toHaveBeenCalledOnce();
  });

  it("fails closed after Host replacement", async () => {
    const waitForConnection = vi.fn(async () => connectionIdentity(5));

    await expect(prepareSameHostTransportRetry(4, waitForConnection)).resolves.toBe(false);
    expect(waitForConnection).toHaveBeenCalledOnce();
  });

  it("does not wait when the original Host epoch was unavailable", async () => {
    const waitForConnection = vi.fn(async () => connectionIdentity(4));

    await expect(prepareSameHostTransportRetry(undefined, waitForConnection)).resolves.toBe(false);
    expect(waitForConnection).not.toHaveBeenCalled();
  });
});
