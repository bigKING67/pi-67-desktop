import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armSessionImportBootstrapWatchdog,
  cancelSessionImportBootstrapWatchdog,
  invalidateSessionImportBootstrapWatchdog,
  SESSION_IMPORT_BOOTSTRAP_GRACE_MS
} from "./session-import-bootstrap-watchdog.js";

const identity = { hostEpoch: 7, operationId: "operation-import" };

describe("session import bootstrap watchdog", () => {
  afterEach(() => {
    invalidateSessionImportBootstrapWatchdog();
    vi.useRealTimers();
  });

  it("expires once after a bounded Bootstrap grace period", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();

    expect(armSessionImportBootstrapWatchdog(identity, expired)).toBe(true);
    expect(armSessionImportBootstrapWatchdog(identity, expired)).toBe(false);
    await vi.advanceTimersByTimeAsync(SESSION_IMPORT_BOOTSTRAP_GRACE_MS - 1);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(expired).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(SESSION_IMPORT_BOOTSTRAP_GRACE_MS);
    expect(expired).toHaveBeenCalledOnce();
  });

  it("is cancelled only by the matching Host and Operation", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    armSessionImportBootstrapWatchdog(identity, expired);

    expect(cancelSessionImportBootstrapWatchdog({ ...identity, hostEpoch: 8 })).toBe(false);
    expect(cancelSessionImportBootstrapWatchdog(identity)).toBe(true);
    await vi.advanceTimersByTimeAsync(SESSION_IMPORT_BOOTSTRAP_GRACE_MS);

    expect(expired).not.toHaveBeenCalled();
  });
});
