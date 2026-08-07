import { createHash } from "node:crypto";
import { link, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { OperationAccepted, OperationSettled } from "@pi67/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { operationReceiptScopeKey } from "./operation-receipt-contract.js";
import { operationReceiptLedgerPath } from "./operation-receipt-storage.js";
import { OperationReceiptStore } from "./operation-receipt-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OperationReceiptStore", () => {
  it("persists only bounded authority metadata and never raw operation content", async () => {
    const root = await temporaryRoot();
    const store = durableStore(root);
    const privateCommand = "inspect private source body";
    const accepted = {
      ...operationAccepted("operation-private", 7),
      sessionFileIdentity: "session-file-v1\0device\0inode\0birthtime"
    };

    await store.rememberAccepted({
      submissionId: "submission-private",
      fingerprint: fingerprint(privateCommand),
      operationKind: "command",
      startedAt: 10,
      accepted
    });

    const path = operationReceiptLedgerPath(root, scopeKeyFromStorePath())!;
    const serialized = await readFile(path, "utf8");
    expect(serialized).not.toContain(privateCommand);
    expect(serialized).toContain(fingerprint(privateCommand));
    expect(JSON.parse(serialized)).toMatchObject({
      version: 1,
      records: [{
        submissionId: "submission-private",
        operationId: "operation-private",
        operationKind: "command",
        stage: "accepted",
        authority: {
          sessionId: "session-1",
          sessionFileIdentity: "session-file-v1\0device\0inode\0birthtime",
          sessionGeneration: 3
        }
      }]
    });
    if (process.platform !== "win32") {
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
      expect((await lstat(dirname(path))).mode & 0o777).toBe(0o700);
    }
  });

  it("returns the original receipt and rejects changed content for one submission ID", async () => {
    const store = durableStore(await temporaryRoot());
    const input = {
      submissionId: "submission-stable",
      fingerprint: fingerprint("same"),
      operationKind: "prompt" as const,
      startedAt: 10,
      accepted: operationAccepted("operation-stable", 7)
    };

    await expect(store.rememberAccepted(input)).resolves.toMatchObject({ created: true });
    await expect(store.rememberAccepted({
      ...input,
      accepted: operationAccepted("operation-new-must-not-win", 8)
    })).resolves.toMatchObject({
      created: false,
      record: { operationId: "operation-stable", acceptedHostEpoch: 7 }
    });
    await expect(store.rememberAccepted({
      ...input,
      fingerprint: fingerprint("changed")
    })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
  });

  it("settles every queued submission for one Operation with one canonical terminal", async () => {
    const store = durableStore(await temporaryRoot());
    const accepted = operationAccepted("operation-shared", 7);
    for (const submissionId of ["submission-main", "submission-queued"]) {
      await store.rememberAccepted({
        submissionId,
        fingerprint: fingerprint(submissionId),
        operationKind: "prompt",
        startedAt: 10,
        accepted
      });
      await store.markRunning(submissionId, fingerprint(submissionId));
    }
    const terminal = completed("operation-shared", 7);

    await expect(store.settleOperation("operation-shared", terminal)).resolves.toEqual([
      expect.objectContaining({ submissionId: "submission-main", stage: "settled", terminal }),
      expect.objectContaining({ submissionId: "submission-queued", stage: "settled", terminal })
    ]);

    const conflicting = { ...terminal, lifecycle: "lost", reason: "late host" } as OperationSettled;
    await expect(store.settleOperation("operation-shared", conflicting)).resolves.toEqual([
      expect.objectContaining({ terminal }),
      expect.objectContaining({ terminal })
    ]);
  });

  it("persists a failed terminal whose structured error omits optional fields", async () => {
    const root = await temporaryRoot();
    const store = durableStore(root);
    await remember(store, "submission-failed", "operation-failed", 10);
    const terminal: OperationSettled = {
      ...completed("operation-failed", 7),
      lifecycle: "failed",
      error: { code: "INTERNAL", message: "bounded failure", recoverable: true }
    };

    await store.settleOperation("operation-failed", terminal);
    await expect(durableStore(root).records()).resolves.toEqual([
      expect.objectContaining({ stage: "settled", terminal })
    ]);
  });

  it("prunes only settled receipts and fails before exceeding an unsettled limit", async () => {
    const root = await temporaryRoot();
    const store = new OperationReceiptStore(scope(), { storageRoot: root, maxReceipts: 2 });
    await remember(store, "submission-1", "operation-1", 1);
    await store.settleOperation("operation-1", completed("operation-1", 7, 1));
    await remember(store, "submission-2", "operation-2", 2);
    await remember(store, "submission-3", "operation-3", 3);
    expect((await store.records()).map((record) => record.submissionId)).toEqual([
      "submission-2",
      "submission-3"
    ]);

    const full = new OperationReceiptStore(scope("task-full"), { storageRoot: root, maxReceipts: 1 });
    await remember(full, "submission-a", "operation-a", 1);
    await expect(remember(full, "submission-b", "operation-b", 2)).rejects.toMatchObject({
      code: "RESOURCE_LIMIT_EXCEEDED"
    });
    expect((await full.records()).map((record) => record.submissionId)).toEqual(["submission-a"]);
  });

  it("fails closed on a malformed durable ledger", async () => {
    const root = await temporaryRoot();
    const store = durableStore(root);
    await remember(store, "submission-safe", "operation-safe", 1);
    const path = operationReceiptLedgerPath(root, scopeKeyFromStorePath())!;
    await writeFile(path, "{not-json", "utf8");

    await expect(store.records()).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      details: { operationReceiptIntegrity: true }
    });
    await expect(remember(store, "submission-new", "operation-new", 2)).rejects.toMatchObject({
      code: "RUNTIME_POISONED"
    });
  });

  it("fails closed when the receipt ledger has another hard-link name", async () => {
    const root = await temporaryRoot();
    const store = durableStore(root);
    await remember(store, "submission-linked", "operation-linked", 1);
    const path = operationReceiptLedgerPath(root, scopeKeyFromStorePath())!;
    await link(path, `${path}.alias`);

    await expect(store.records()).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      details: { operationReceiptIntegrity: true }
    });
  });
});

async function remember(
  store: OperationReceiptStore,
  submissionId: string,
  operationId: string,
  startedAt: number
): Promise<void> {
  await store.rememberAccepted({
    submissionId,
    fingerprint: fingerprint(submissionId),
    operationKind: "prompt",
    startedAt,
    accepted: operationAccepted(operationId, 7)
  });
}

function durableStore(root: string): OperationReceiptStore {
  return new OperationReceiptStore(scope(), { storageRoot: root });
}

function scope(taskId = "task-1") {
  return { workspaceId: "workspace-1", taskId, taskGeneration: 2 };
}

function operationAccepted(operationId: string, hostEpoch: number): OperationAccepted {
  return {
    kind: "accepted",
    operationId,
    cancellable: true,
    hostEpoch,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 3
  };
}

function completed(operationId: string, hostEpoch: number, startedAt = 10): OperationSettled {
  return {
    kind: "settled",
    operationId,
    operationKind: "prompt",
    cancellable: false,
    hostEpoch,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 3,
    startedAt,
    settledAt: startedAt + 10,
    lifecycle: "completed"
  };
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-operation-receipt-"));
  roots.push(root);
  return root;
}

function scopeKeyFromStorePath(): string {
  return operationReceiptScopeKey(scope());
}
