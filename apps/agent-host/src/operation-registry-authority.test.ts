import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { OperationRegistry } from "./operation-registry.js";

describe("OperationRegistry physical Session authority", () => {
  it("moves a completed Session import receipt to the resulting Session authority", async () => {
    const events: AgentEvent[] = [];
    let identity = runtimeIdentity("session-before-import", 2);
    let finish!: () => void;
    const registry = new OperationRegistry(
      3,
      () => identity,
      (event) => events.push(event)
    );
    const accepted = await registry.accept({
      submissionId: "session-import-stable",
      fingerprint: "same-import",
      kind: "session-import",
      execute: () => new Promise<void>((resolve) => {
        finish = () => {
          identity = runtimeIdentity("session-after-import", 3);
          resolve();
        };
      })
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));
    finish();
    await vi.waitFor(() => expect(events.some((event) => event.type === "operation.completed")).toBe(true));

    expect(registry.submissionFor("session-import-stable", "same-import")).toMatchObject({
      kind: "settled",
      operationId: accepted.operationId,
      operationKind: "session-import",
      lifecycle: "completed",
      sessionId: "session-after-import",
      sessionFileIdentity: "session-file-session-after-import",
      sessionGeneration: 3
    });

    identity = runtimeIdentity("later-session", 4);
    expect(() => registry.submissionFor("session-import-stable", "same-import"))
      .toThrowError(expect.objectContaining({ code: "STALE_SESSION_IDENTITY" }));
  });

  it("does not replay a completed submission into a different Session with the same generation", async () => {
    let identity = runtimeIdentity("session-1", 2);
    const registry = createRegistry(() => identity);
    await registry.accept({
      submissionId: "submission-session-bound",
      fingerprint: "same",
      kind: "prompt",
      execute: () => new Promise<void>(() => undefined)
    });

    identity = runtimeIdentity("session-2", 2);

    expect(() => registry.submissionFor("submission-session-bound", "same"))
      .toThrowError(expect.objectContaining({ code: "STALE_SESSION_IDENTITY" }));
  });

  it("does not replay a submission when the same Session ID points at another physical JSONL", async () => {
    let identity = runtimeIdentity("session-1", 2);
    const registry = createRegistry(() => identity);
    await registry.accept({
      submissionId: "submission-physical-session-bound",
      fingerprint: "same",
      kind: "prompt",
      execute: () => new Promise<void>(() => undefined)
    });

    identity = {
      ...identity,
      sessionFileIdentity: "session-file-other"
    };

    expect(() => registry.submissionFor("submission-physical-session-bound", "same"))
      .toThrowError(expect.objectContaining({ code: "STALE_SESSION_IDENTITY" }));
  });
});

function createRegistry(getIdentity: () => ReturnType<typeof runtimeIdentity>): OperationRegistry {
  return new OperationRegistry(3, getIdentity, () => undefined);
}

function runtimeIdentity(sessionId: string, sessionGeneration: number) {
  return {
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionGeneration
  };
}
