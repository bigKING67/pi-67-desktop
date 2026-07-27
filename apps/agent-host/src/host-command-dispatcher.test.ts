import type { AgentRuntime } from "@pi67/pi-runtime";
import { describe, expect, it, vi } from "vitest";
import type { AgentCommand } from "@pi67/protocol";
import {
  dispatchHostCommand,
  operationSubmissionIdentity
} from "./host-command-dispatcher.js";

describe("operationSubmissionIdentity", () => {
  it("keeps caller identity separate from the canonical import fingerprint", () => {
    const first = identity("session.import", { submissionId: "import-a", path: "/tmp/session.jsonl" });
    const second = identity("session.import", { submissionId: "import-b", path: "/tmp/session.jsonl" });

    expect(first.submissionId).toBe("import-a");
    expect(second.submissionId).toBe("import-b");
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("changes the fingerprint when canonical operation content changes", () => {
    expect(identity("session.import", {
      submissionId: "import-1",
      path: "/tmp/session-a.jsonl"
    }).fingerprint).not.toBe(identity("session.import", {
      submissionId: "import-1",
      path: "/tmp/session-b.jsonl"
    }).fingerprint);

    expect(identity("session.compact", {
      submissionId: "compact-1",
      instructions: "Keep test failures"
    }).fingerprint).not.toBe(identity("session.compact", {
      submissionId: "compact-1",
      instructions: "Keep architecture decisions"
    }).fingerprint);

    expect(identity("command.invoke", {
      submissionId: "command-1",
      command: "inspect"
    }).fingerprint).not.toBe(identity("command.invoke", {
      submissionId: "command-1",
      command: "doctor"
    }).fingerprint);
  });

  it("stores only a fixed-width SHA-256 fingerprint", () => {
    const rawValues = [
      "/Users/example/private/session.jsonl",
      "Preserve the private deployment notes",
      "inspect --private-value"
    ];
    const identities = [
      identity("session.import", { submissionId: "import-1", path: rawValues[0]! }),
      identity("session.compact", { submissionId: "compact-1", instructions: rawValues[1]! }),
      identity("command.invoke", { submissionId: "command-1", command: rawValues[2]! })
    ];

    for (const [index, submission] of identities.entries()) {
      expect(submission.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(submission.fingerprint).not.toContain(rawValues[index]!);
    }
  });

  it("serves model and resource queries without constructing a Session snapshot", async () => {
    const models = [{
      provider: "openai",
      id: "gpt-5.6",
      label: "GPT-5.6",
      configured: true,
      reasoning: true
    }];
    const resources = [{
      kind: "skill" as const,
      id: "testing",
      label: "Testing",
      status: "ready" as const
    }];
    const getSnapshot = vi.fn(() => {
      throw new Error("Query commands must not construct a Session snapshot.");
    });
    const runtime = {
      getModels: vi.fn(() => models),
      getResources: vi.fn(() => resources),
      getSnapshot
    } as unknown as AgentRuntime;

    await expect(dispatchHostCommand(
      runtime,
      { type: "model.list", payload: {} },
      {} as never
    )).resolves.toEqual(models);
    await expect(dispatchHostCommand(
      runtime,
      { type: "resource.list", payload: {} },
      {} as never
    )).resolves.toEqual(resources);
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});

function identity<T extends "session.import" | "session.compact" | "command.invoke">(
  type: T,
  payload: Extract<AgentCommand, { type: T }>["payload"]
) {
  const result = operationSubmissionIdentity({ type, payload } as Extract<AgentCommand, { type: T }>);
  if (!result) throw new Error(`Expected an operation submission identity for ${type}.`);
  return result;
}
