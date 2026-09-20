import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@pi67/pi-runtime/pi-sdk-types";
import type { OVClient } from "./client.js";
import type { SyncManager } from "./sync.js";
import { registerDesktopMemoryCommit } from "./desktop-memory-commit.js";

describe("loaded private owner metadata", () => {
  it("uses the exact OV lineage, does not create or flush, and rejects stale replies", async () => {
    const emitter = new EventEmitter();
    const events = { emit: (name: string, value: unknown) => { emitter.emit(name, value); },
      on: (name: string, handler: (value: unknown) => void) => { emitter.on(name, handler); return () => { emitter.off(name, handler); }; } };
    let shutdown!: () => Promise<void>;
    const pi = { events, on: (_name: string, fn: typeof shutdown) => { shutdown = fn; } } as unknown as ExtensionAPI;
    const getSession = vi.fn(async () => ({ session_id: "pi-current-lineage-2", message_count: 3 }));
    const client = { cfg: { privacyMode: "read-only", takeoverKeepRecentTurns: 3, takeoverEnabled: true }, getSession } as unknown as OVClient;
    const sync = { piSessionId: "current", sessionId: "pi-current-lineage-2", blockedReason: undefined } as unknown as SyncManager;
    registerDesktopMemoryCommit(pi, client, sync, () => true);
    let inspect!: (request: { sessionId: string; isCurrent(): boolean }) => Promise<unknown>;
    events.emit("pi67:private-memory:inspect", { provide: (value: typeof inspect) => { inspect = value; } });
    await expect(inspect({ sessionId: "other", isCurrent: () => true })).rejects.toThrow();
    expect(getSession).not.toHaveBeenCalled();
    await expect(inspect({ sessionId: "current", isCurrent: () => true })).resolves.toMatchObject({ capturedTurns: 3, privacyMode: "read-only" });
    expect(getSession).toHaveBeenCalledWith("pi-current-lineage-2", false);
    let current = true;
    getSession.mockImplementation(async () => { current = false; return { session_id: "pi-current-lineage-2", message_count: 3 }; });
    await expect(inspect({ sessionId: "current", isCurrent: () => current })).rejects.toThrow();
    await shutdown();
    await expect(inspect({ sessionId: "current", isCurrent: () => true })).rejects.toThrow();
  });
});
