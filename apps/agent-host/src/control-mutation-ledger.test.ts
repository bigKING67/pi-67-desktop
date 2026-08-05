import { describe, expect, it, vi } from "vitest";
import type { RuntimeIdentity } from "@pi67/domain";
import type {
  AgentCommand,
  ProjectionMutationAcknowledgement
} from "@pi67/protocol";
import { ControlMutationLedger } from "./control-mutation-ledger.js";

type ActiveRuntimeIdentity = Required<Pick<RuntimeIdentity, "sessionId" | "sessionGeneration">>;

describe("ControlMutationLedger", () => {
  it("shares one pending execution and replays the settled result", async () => {
    let identity: ActiveRuntimeIdentity = { sessionId: "session-a", sessionGeneration: 1 };
    let finish!: (value: ProjectionMutationAcknowledgement) => void;
    const execute = vi.fn(() => new Promise<ProjectionMutationAcknowledgement>((resolve) => {
      finish = resolve;
    }));
    const ledger = new ControlMutationLedger(4, () => identity);
    const command = controlCommand("session.create", { creationId: "session-creation-ledger" });

    const first = ledger.run("mutation-1", command, execute);
    const retry = ledger.run("mutation-1", command, execute);
    await Promise.resolve();
    expect(execute).toHaveBeenCalledOnce();

    identity = { sessionId: "session-b", sessionGeneration: 2 };
    finish(acknowledgement(identity));
    await expect(first).resolves.toMatchObject({ sessionId: "session-b" });
    await expect(retry).resolves.toMatchObject({ sessionId: "session-b" });
    await expect(ledger.run("mutation-1", command, execute)).resolves.toMatchObject({ sessionId: "session-b" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects key reuse for a different payload without exposing secret values", async () => {
    const identity = { sessionId: "session-a", sessionGeneration: 1 };
    const ledger = new ControlMutationLedger(2, () => identity);
    const first = controlCommand("model.setRuntimeKey", { provider: "openai", apiKey: "sk-private-one" });
    await ledger.run("mutation-secret", first, async () => acknowledgement(identity));

    const conflicting = controlCommand("model.setRuntimeKey", { provider: "openai", apiKey: "sk-private-two" });
    expect(() => ledger.run("mutation-secret", conflicting, async () => acknowledgement(identity)))
      .toThrowError(expect.objectContaining({ code: "DUPLICATE_REQUEST" }));
    try {
      void ledger.run("mutation-secret", conflicting, async () => acknowledgement(identity));
    } catch (error) {
      expect(String(error)).not.toContain("sk-private-one");
      expect(String(error)).not.toContain("sk-private-two");
    }
  });

  it("rejects replay after session authority changes or a newer mutation supersedes the result", async () => {
    let identity: ActiveRuntimeIdentity = { sessionId: "session-a", sessionGeneration: 1 };
    const ledger = new ControlMutationLedger(7, () => identity);
    const open = controlCommand("session.open", { path: "/tmp/b.jsonl" });
    await ledger.run("open-b", open, async () => {
      identity = { sessionId: "session-b", sessionGeneration: 2 };
      return acknowledgement(identity);
    });

    const select = controlCommand("model.select", { provider: "openai", id: "gpt-5.6" });
    await ledger.run("select-model", select, async () => acknowledgement(identity));
    expect(() => ledger.run("open-b", open, async () => acknowledgement(identity)))
      .toThrowError(expect.objectContaining({ code: "DUPLICATE_REQUEST" }));

    identity = { sessionId: "session-c", sessionGeneration: 3 };
    expect(() => ledger.run("select-model", select, async () => acknowledgement(identity)))
      .toThrowError(expect.objectContaining({ code: "STALE_SESSION_GENERATION" }));
  });

  it("keeps the replay cache bounded and never evicts pending work", async () => {
    let now = 0;
    const identity = { sessionId: "session-a", sessionGeneration: 1 };
    const ledger = new ControlMutationLedger(3, () => identity, {
      maxEntries: 2,
      maxPending: 1,
      retentionMs: 100,
      now: () => now
    });
    let finish!: (value: ProjectionMutationAcknowledgement) => void;
    const pending = ledger.run("pending", controlCommand("session.create", { creationId: "session-creation-pending" }), () => (
      new Promise<ProjectionMutationAcknowledgement>((resolve) => { finish = resolve; })
    ));
    await Promise.resolve();

    expect(() => ledger.run("overflow", controlCommand("session.open", { path: "/tmp/other.jsonl" }), async () => (
      acknowledgement({ sessionId: "other", sessionGeneration: 2 })
    )))
      .toThrowError(expect.objectContaining({ code: "RESOURCE_LIMIT_EXCEEDED" }));
    finish(acknowledgement(identity));
    await pending;

    now = 101;
    const execute = vi.fn(async () => acknowledgement(identity));
    await ledger.run("pending", controlCommand("session.create", { creationId: "session-creation-pending" }), execute);
    expect(execute).toHaveBeenCalledOnce();
  });
});

function controlCommand<T extends AgentCommand["type"]>(
  type: T,
  payload: Extract<AgentCommand, { type: T }>["payload"]
): Extract<AgentCommand, { type: T }> {
  return { type, payload } as Extract<AgentCommand, { type: T }>;
}

function acknowledgement(
  identity: ActiveRuntimeIdentity
): ProjectionMutationAcknowledgement {
  return {
    accepted: true,
    hostEpoch: 4,
    sessionId: identity.sessionId,
    sessionGeneration: identity.sessionGeneration,
    eventSequence: 1
  };
}
