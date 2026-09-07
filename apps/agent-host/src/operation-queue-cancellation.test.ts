import { afterEach, expect, it, vi } from "vitest";
import type { AgentEvent } from "@pi67/protocol";
import { RuntimePromptAttachments } from "../../../packages/pi-runtime/src/runtime-prompt-attachments.js";
import type { PreparedPromptImage } from "../../../packages/pi-runtime/src/prompt-attachment.js";
import { OperationRegistry } from "./operation-registry.js";

afterEach(() => vi.useRealTimers());

it.each([
  ["steer", false], ["followUp", false], ["steer", true], ["followUp", true]
] as const)("cancels pending %s attachment preparation; stuck abort=%s", async (delivery, stuckAbort) => {
  const events: AgentEvent[] = [];
  const replacement = vi.fn();
  let finishPrompt!: () => void;
  let releaseImages!: (images: PreparedPromptImage[]) => void;
  const prompt = new Promise<void>((resolve) => { finishPrompt = resolve; });
  const attachments = new RuntimePromptAttachments({
    readImages: () => new Promise((resolve) => { releaseImages = resolve; }),
    claim: async () => undefined,
    read: async () => ({ text: "", details: { operation: "list", setId: "set-a", truncated: false } })
  });
  const session = {
    model: { input: ["text", "image"] },
    sendCustomMessage: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined), followUp: vi.fn(async () => undefined)
  };
  const registry = new OperationRegistry(5, identity, (event) => events.push(event), {
    abortWatchdogMs: 20, onRuntimePoisoned: replacement
  });
  const accepted = await registry.accept({
    submissionId: "base", fingerprint: "base", kind: "prompt", execute: () => prompt,
    abort: () => stuckAbort ? new Promise<void>(() => undefined) : Promise.resolve(finishPrompt())
  });
  await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));
  const queued = registry.queueForActive("queued", "queued", (signal) => attachments[delivery](
    session as unknown as Parameters<RuntimePromptAttachments["steer"]>[0], "queued", {
      id: "set-a", attachments: [{ id: "image-a", name: "fixture.png", mimeType: "image/png", byteLength: 3, kind: "image" }]
    }, signal
  )).catch((error: unknown) => error);
  await vi.waitFor(() => expect(releaseImages).toBeTypeOf("function"));
  vi.useFakeTimers();
  const abort = registry.abort(accepted.operationId).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(25);
  expect(await queued).toMatchObject({ code: "STALE_OPERATION" });
  if (stuckAbort) {
    expect(await abort).toMatchObject({ code: "RUNTIME_POISONED" });
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.lost"]);
    expect(replacement).toHaveBeenCalledOnce();
  } else {
    expect(await abort).toMatchObject({ aborted: true });
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.cancelled"]);
    expect(replacement).not.toHaveBeenCalled();
  }
  if (stuckAbort) expect(() => registry.submissionFor("queued", "queued")).toThrow("poisoned");
  else expect(registry.submissionFor("queued", "queued")).toMatchObject({ lifecycle: "cancelled" });
  releaseImages([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(session.sendCustomMessage).not.toHaveBeenCalled();
  expect(session.steer).not.toHaveBeenCalled();
  expect(session.followUp).not.toHaveBeenCalled();
  expect(events).toHaveLength(2);
  expect(registry.latestTerminal()?.lifecycle).toBe(stuckAbort ? "lost" : "cancelled");
});

it("keeps ordinary completion waiting for an admitted queue and persists one terminal", async () => {
  const events: AgentEvent[] = [];
  let finishPrompt!: () => void;
  let finishQueue!: () => void;
  const registry = new OperationRegistry(5, identity, (event) => events.push(event));
  await registry.accept({ submissionId: "base", fingerprint: "base", kind: "prompt",
    execute: () => new Promise((resolve) => { finishPrompt = resolve; }) });
  await vi.waitFor(() => expect(finishPrompt).toBeTypeOf("function"));
  const queued = registry.queueForActive("queued", "queued", () => new Promise((resolve) => { finishQueue = resolve; }));
  await vi.waitFor(() => expect(finishQueue).toBeTypeOf("function"));
  finishPrompt();
  await Promise.resolve();
  expect(events.some((event) => event.type === "operation.completed")).toBe(false);
  finishQueue();
  await queued;
  await vi.waitFor(() => expect(registry.latestTerminal()?.lifecycle).toBe("completed"));
  expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.completed"]);
});

it("observes late queue rejection and permits fresh queues after abort failure", async () => {
  let rejectQueue!: (error: Error) => void;
  const registry = new OperationRegistry(5, identity, () => undefined);
  const accepted = await registry.accept({ submissionId: "base", fingerprint: "base", kind: "prompt",
    execute: () => new Promise<void>(() => undefined), abort: async () => { throw new Error("abort failed"); } });
  const queued = registry.queueForActive("queued", "queued", () => new Promise((_, reject) => { rejectQueue = reject; }))
    .catch((error: unknown) => error);
  await vi.waitFor(() => expect(rejectQueue).toBeTypeOf("function"));
  await expect(registry.abort(accepted.operationId)).rejects.toThrow("abort failed");
  expect(await queued).toMatchObject({ code: "STALE_OPERATION" });
  rejectQueue(new Error("late dependency failure"));
  const next = vi.fn(async (signal: AbortSignal) => { expect(signal.aborted).toBe(false); });
  await registry.queueForActive("next", "next", next);
  expect(next).toHaveBeenCalledOnce();
  await registry.loseActive("test cleanup");
});


it("forces loss without waiting for non-cooperative queued work", async () => {
  const events: AgentEvent[] = [];
  const registry = new OperationRegistry(5, identity, (event) => events.push(event));
  await registry.accept({ submissionId: "base", fingerprint: "base", kind: "prompt",
    execute: () => new Promise<void>(() => undefined) });
  let started = false;
  const queued = registry.queueForActive("queued", "queued", async () => {
    started = true;
    await new Promise<void>(() => undefined);
  }).catch((error: unknown) => error);
  await vi.waitFor(() => expect(started).toBe(true));
  await registry.loseActive("Host is retiring");
  expect(await queued).toMatchObject({ code: "STALE_OPERATION" });
  expect(registry.latestTerminal()?.lifecycle).toBe("lost");
  expect(events.filter((event) => event.type === "operation.lost")).toHaveLength(1);
});

function identity() {
  return { sessionId: "session-a", sessionFileIdentity: "file-a", sessionGeneration: 1 };
}
