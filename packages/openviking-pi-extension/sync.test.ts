import { describe, expect, it } from "vitest";
import { SyncManager } from "./sync.js";

describe("OpenViking SyncManager Session identity", () => {
  it("keeps the raw Pi Session identity separate from the derived OpenViking Session ID", async () => {
    const sync = new SyncManager({} as never, {} as never);

    await expect(sync.ensureSession("pi-jsonl-session-1")).resolves.toBe(true);

    expect(sync.piSessionId).toBe("pi-jsonl-session-1");
    expect(sync.sessionId).toMatch(/^pi-/u);
    expect(sync.sessionId).not.toBe(sync.piSessionId);
  });
});
