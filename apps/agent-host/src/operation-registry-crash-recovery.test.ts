import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operationReceiptLedgerPath } from "./operation-receipt-storage.js";
import { OperationReceiptStore } from "./operation-receipt-store.js";
import { operationReceiptScopeKey } from "./operation-receipt-contract.js";
import { OperationRegistry } from "./operation-registry.js";

describe("OperationRegistry durable crash recovery", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("recovers an unresolved side effect as lost and never invokes it in the replacement Host", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-operation-crash-"));
    const firstEvents: AgentEvent[] = [];
    let finishFirst!: () => void;
    const firstExecute = vi.fn(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const first = registry(1, store(root), firstEvents);
    const accepted = await first.accept({
      submissionId: "submission-crash",
      fingerprint: fingerprint("same prompt"),
      kind: "prompt",
      execute: firstExecute
    });
    await vi.waitFor(() => expect(firstExecute).toHaveBeenCalledOnce());

    const replacementEvents: AgentEvent[] = [];
    const replacement = registry(2, store(root), replacementEvents);
    await replacement.reconcile();

    expect(replacement.latestTerminal()).toMatchObject({
      operationId: accepted.operationId,
      lifecycle: "lost",
      hostEpoch: 2
    });
    const replacementExecute = vi.fn(async () => undefined);
    await expect(replacement.accept({
      submissionId: "submission-crash",
      fingerprint: fingerprint("same prompt"),
      kind: "prompt",
      execute: replacementExecute
    })).resolves.toMatchObject({
      operationId: accepted.operationId,
      lifecycle: "lost",
      hostEpoch: 2
    });
    expect(replacementExecute).not.toHaveBeenCalled();
    await expect(replacement.accept({
      submissionId: "submission-crash",
      fingerprint: fingerprint("changed prompt"),
      kind: "prompt",
      execute: replacementExecute
    })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
    expect(replacementExecute).not.toHaveBeenCalled();

    finishFirst();
    await vi.waitFor(() => expect(firstEvents.some((event) => event.type === "operation.lost")).toBe(true));
    expect(firstEvents.some((event) => event.type === "operation.completed")).toBe(false);
  });

  it("persists queued prompt delivery before invoking Pi and replays it only as lost", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-operation-queue-crash-"));
    const firstEvents: AgentEvent[] = [];
    let finishFirst!: () => void;
    const first = registry(2, store(root), firstEvents);
    const accepted = await first.accept({
      submissionId: "submission-main",
      fingerprint: fingerprint("main prompt"),
      kind: "prompt",
      execute: () => new Promise<void>((resolve) => { finishFirst = resolve; })
    });
    await vi.waitFor(() => expect(firstEvents.some((event) => event.type === "operation.started")).toBe(true));
    const firstQueue = vi.fn(async () => undefined);
    await first.queueForActive("submission-queue", fingerprint("queued prompt"), firstQueue);
    expect(firstQueue).toHaveBeenCalledOnce();

    const replacement = registry(3, store(root), []);
    await replacement.reconcile();
    const replacementQueue = vi.fn(async () => undefined);
    await expect(replacement.queueForActive(
      "submission-queue",
      fingerprint("queued prompt"),
      replacementQueue
    )).resolves.toMatchObject({
      operationId: accepted.operationId,
      lifecycle: "lost",
      hostEpoch: 3
    });
    expect(replacementQueue).not.toHaveBeenCalled();

    finishFirst();
    await vi.waitFor(() => expect(firstEvents.some((event) => event.type === "operation.lost")).toBe(true));
  });

  it("restores a settled terminal under the replacement Host epoch", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-operation-settled-"));
    const firstEvents: AgentEvent[] = [];
    const first = registry(4, store(root), firstEvents);
    const accepted = await first.accept({
      submissionId: "submission-settled",
      fingerprint: fingerprint("settled prompt"),
      kind: "prompt",
      execute: async () => undefined
    });
    await vi.waitFor(() => expect(firstEvents.some((event) => event.type === "operation.completed")).toBe(true));

    const replacement = registry(5, store(root), []);
    await replacement.reconcile();
    expect(replacement.submissionFor(
      "submission-settled",
      fingerprint("settled prompt")
    )).toMatchObject({
      operationId: accepted.operationId,
      lifecycle: "completed",
      hostEpoch: 5
    });
  });

  it("fails closed before execution when the durable receipt ledger is corrupt", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-operation-corrupt-"));
    const receiptStore = store(root);
    await receiptStore.records();
    const path = operationReceiptLedgerPath(root, operationReceiptScopeKey(scope));
    if (!path) throw new Error("Expected a durable receipt path.");
    await writeFile(path, "{broken", "utf8");
    const execute = vi.fn(async () => undefined);
    const poisoned = registry(8, store(root), []);

    await expect(poisoned.accept({
      submissionId: "submission-corrupt",
      fingerprint: fingerprint("corrupt prompt"),
      kind: "prompt",
      execute
    })).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      details: { operationReceiptIntegrity: true }
    });
    expect(execute).not.toHaveBeenCalled();
    expect(poisoned.isPoisoned()).toBe(true);
  });
});

const scope = { workspaceId: "workspace-crash", taskId: "task-crash", taskGeneration: 1 };

function store(storageRoot: string): OperationReceiptStore {
  return new OperationReceiptStore(scope, { storageRoot });
}

function registry(
  hostEpoch: number,
  receiptStore: OperationReceiptStore,
  events: AgentEvent[]
): OperationRegistry {
  return new OperationRegistry(
    hostEpoch,
    () => ({
      sessionId: "session-crash",
      sessionFileIdentity: "session-file-crash",
      sessionGeneration: 3
    }),
    (event) => events.push(event),
    { receiptStore }
  );
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
