import { describe, expect, it, vi } from "vitest";
import { commitEndedSession } from "./shutdown-commit.js";

function fakes(pendingTokens: number | undefined, options: { flushed?: boolean; committed?: boolean; sessionId?: string | null } = {}) {
  const sync = {
    sessionId: options.sessionId === undefined ? "pi-session" : options.sessionId,
    flushForTakeover: vi.fn(async () => options.flushed ?? true),
    commit: vi.fn(async () => options.committed === false ? null : { status: "accepted", archived: true } as never),
  };
  const client = { getSession: vi.fn(async () => pendingTokens === undefined ? null : { pending_tokens: pendingTokens } as never) };
  return { sync, client, config: { shutdownCommitMinTokens: 1000 } };
}

describe("ended-Session Commit", () => {
  it.each(["quit", "new", "resume", "fork"])("archives the whole Session when it ends by %s with enough content", async (reason) => {
    const { sync, client, config } = fakes(1000);
    await expect(commitEndedSession(reason, sync, client, config)).resolves.toBe("committed");
    expect(sync.flushForTakeover).toHaveBeenCalledBefore(client.getSession);
    expect(sync.commit).toHaveBeenCalledWith({ keepRecentCount: 0 });
  });

  it.each(["reload", undefined, 7])("leaves a continuing or unknown shutdown (%s) to takeover", async (reason) => {
    const { sync, client, config } = fakes(50_000);
    await expect(commitEndedSession(reason, sync, client, config)).resolves.toBe("not-ended");
    expect(sync.flushForTakeover).not.toHaveBeenCalled();
    expect(sync.commit).not.toHaveBeenCalled();
  });

  it("skips short or unreadable Sessions so trivial exchanges do not pay for extraction", async () => {
    for (const pending of [999, 0, undefined]) {
      const { sync, client, config } = fakes(pending);
      await expect(commitEndedSession("quit", sync, client, config)).resolves.toBe("below-threshold");
      expect(sync.commit).not.toHaveBeenCalled();
    }
  });

  it("never commits a Session whose captured turns were not all delivered", async () => {
    const { sync, client, config } = fakes(5000, { flushed: false });
    await expect(commitEndedSession("quit", sync, client, config)).resolves.toBe("unflushed");
    expect(client.getSession).not.toHaveBeenCalled();
    expect(sync.commit).not.toHaveBeenCalled();
  });

  it("reports missing lineage and rejected commits", async () => {
    const missing = fakes(5000, { sessionId: null });
    await expect(commitEndedSession("quit", missing.sync, missing.client, missing.config)).resolves.toBe("no-session");
    const rejected = fakes(5000, { committed: false });
    await expect(commitEndedSession("quit", rejected.sync, rejected.client, rejected.config)).resolves.toBe("failed");
  });

  it("returns at the deadline instead of holding app quit", async () => {
    vi.useFakeTimers();
    try {
      const { sync, client, config } = fakes(5000);
      sync.flushForTakeover.mockImplementation(() => new Promise<boolean>(() => {}));
      const outcome = commitEndedSession("quit", sync, client, config, 200);
      await vi.advanceTimersByTimeAsync(200);
      await expect(outcome).resolves.toBe("timeout");
      expect(sync.commit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
