import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSessionCreationMarker,
  SESSION_CREATION_MARKER_TYPE,
  SessionCreationReceiptStore
} from "./session-creation-receipt-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SessionCreationReceiptStore", () => {
  it("resolves an exact persisted JSONL marker without adding LLM messages", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-1");

    expect(manager.getEntries()).toEqual([
      expect.objectContaining({
        type: "custom",
        customType: SESSION_CREATION_MARKER_TYPE,
        data: { schemaVersion: 1, creationId: "session-creation-1" }
      })
    ]);
    expect(manager.buildSessionContext().messages).toEqual([]);
    manager.appendThinkingLevelChange("low");

    const identity = await fixture.store.record("session-creation-1", manager);
    await expect(fixture.store.resolve("session-creation-1")).resolves.toEqual({
      status: "materialized",
      creationId: "session-creation-1",
      ...identity
    });

    const listed = await SessionManager.list(fixture.cwd, fixture.sessionDir);
    expect(listed).toEqual([
      expect.objectContaining({ id: manager.getSessionId(), messageCount: 0 })
    ]);
  });

  it("rebuilds a deleted disposable receipt from bounded JSONL scanning", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-rebuild");
    await fixture.store.record("session-creation-rebuild", manager);

    const receiptDirectory = join(fixture.storageRoot, "session-creation-receipts-v1");
    const receipts = await readdir(receiptDirectory);
    expect(receipts).toHaveLength(1);
    await unlink(join(receiptDirectory, receipts[0]!));

    await expect(fixture.store.resolve("session-creation-rebuild")).resolves.toMatchObject({
      status: "materialized",
      creationId: "session-creation-rebuild",
      sessionId: manager.getSessionId(),
      sessionPath: manager.getSessionFile()
    });
    expect(await readdir(receiptDirectory)).toHaveLength(1);
  });

  it("fails closed when one creation id appears in multiple Pi JSONL Sessions", async () => {
    const fixture = await createFixture();
    const first = SessionManager.create(fixture.cwd, fixture.sessionDir);
    const second = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(first, "session-creation-duplicate");
    await appendSessionCreationMarker(second, "session-creation-duplicate");

    await expect(fixture.store.resolve("session-creation-duplicate")).resolves.toEqual({
      status: "ambiguous",
      creationId: "session-creation-duplicate"
    });
  });

  it("returns scan-limit when the total fallback budget is exhausted", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-other");

    await expect(fixture.store.resolve("session-creation-budget", {
      scanBudget: { maxFiles: 0 }
    })).resolves.toEqual({
      status: "unavailable",
      creationId: "session-creation-budget",
      reason: "scan-limit"
    });
  });

  it("propagates caller cancellation instead of reporting a storage failure", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-cancelled");
    const controller = new AbortController();
    const resolution = fixture.store.resolve("session-creation-cancelled", {
      signal: controller.signal
    });
    queueMicrotask(() => controller.abort());

    await expect(resolution).rejects.toMatchObject({ name: "AbortError" });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-creation-"));
  roots.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  const storageRoot = join(root, "storage");
  return {
    cwd,
    sessionDir,
    storageRoot,
    store: new SessionCreationReceiptStore({
      cwd,
      agentDir,
      storageRoot,
      getConfiguredSessionDir: () => sessionDir
    })
  };
}
