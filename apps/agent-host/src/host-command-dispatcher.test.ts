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

  it.each([
    [{ entryId: "entry-before", position: "before" as const }, "before" as const],
    [{ entryId: "entry-default" }, "at" as const]
  ])("forwards the requested Session fork position and defaults legacy callers to at", async (payload, expectedPosition) => {
    const snapshot = { sessionId: "session-forked" } as never;
    const acknowledgement = { accepted: true } as never;
    const forkSession = vi.fn(async () => snapshot);
    const context = {
      commitSessionWriter: vi.fn().mockResolvedValue(undefined),
      sendEvent: vi.fn(),
      captureProjectionMutationAcknowledgement: vi.fn(() => acknowledgement)
    };

    await expect(dispatchHostCommand(
      { forkSession } as unknown as AgentRuntime,
      { type: "session.fork", payload },
      context as never
    )).resolves.toBe(acknowledgement);

    expect(forkSession).toHaveBeenCalledWith(payload.entryId, expectedPosition);
    expect(context.sendEvent).toHaveBeenCalledWith({
      type: "session.bootstrap",
      payload: { snapshot, reason: "session-fork" }
    });
  });

  it("forks from source Task authority and commits only the target writer", async () => {
    const snapshot = { sessionId: "session-target" } as never;
    const acknowledgement = { accepted: true } as never;
    const runtime = { getIdentity: vi.fn() } as unknown as AgentRuntime;
    const payload = {
      sourceTaskId: "task-source",
      sourceTaskGeneration: 3,
      sourceSessionId: "session-source",
      sourceSessionGeneration: 5,
      entryId: "assistant-entry-8"
    } as const;
    const context = {
      forkSessionFromTask: vi.fn(async () => snapshot),
      commitSessionWriter: vi.fn().mockResolvedValue(undefined),
      sendEvent: vi.fn(),
      captureProjectionMutationAcknowledgement: vi.fn(() => acknowledgement)
    };

    await expect(dispatchHostCommand(
      runtime,
      { type: "session.forkFromTask", payload },
      context as never
    )).resolves.toBe(acknowledgement);

    expect(context.forkSessionFromTask).toHaveBeenCalledWith(runtime, payload);
    expect(context.commitSessionWriter).toHaveBeenCalledOnce();
    expect(context.commitSessionWriter).toHaveBeenCalledWith(runtime);
    expect(context.sendEvent).toHaveBeenCalledWith({
      type: "session.bootstrap",
      payload: { snapshot, reason: "session-fork" }
    });
    expect(context.captureProjectionMutationAcknowledgement).toHaveBeenCalledWith(runtime);
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

  it("sets the current Task Tool mode and publishes the authoritative change", async () => {
    const setTaskToolMode = vi.fn(() => "yolo" as const);
    const sendEvent = vi.fn();
    const runtime = { setTaskToolMode } as unknown as AgentRuntime;

    await expect(dispatchHostCommand(
      runtime,
      { type: "task.toolMode.set", payload: { mode: "yolo" } },
      { sendEvent } as never
    )).resolves.toEqual({ mode: "yolo" });

    expect(setTaskToolMode).toHaveBeenCalledWith("yolo");
    expect(sendEvent).toHaveBeenCalledWith({
      type: "task.toolMode.changed",
      payload: { mode: "yolo", reason: "user-selected" }
    });
  });

  it("publishes the AUTO reset when Workspace trust revocation drops YOLO", async () => {
    const reloadResult = { resources: [] } as never;
    const setWorkspacePolicy = vi.fn(() => "auto" as const);
    const runtime = {
      getTaskToolMode: vi.fn(() => "yolo" as const),
      setWorkspacePolicy,
      reloadResources: vi.fn(async () => reloadResult)
    } as unknown as AgentRuntime;
    const sendEvent = vi.fn();

    await expect(dispatchHostCommand(
      runtime,
      { type: "workspace.setTrust", payload: { trust: "unknown", approvalMode: "balanced" } },
      { sendEvent } as never
    )).resolves.toBe(reloadResult);

    expect(setWorkspacePolicy).toHaveBeenCalledWith("unknown", "balanced");
    expect(sendEvent).toHaveBeenCalledWith({
      type: "task.toolMode.changed",
      payload: { mode: "auto", reason: "trust-revoked" }
    });
  });

  it("claims prompt attachments before accepting the operation", async () => {
    const order: string[] = [];
    const attachments = {
      id: "attachment_set_a",
      attachments: [{
        id: "attachment_a",
        name: "notes.txt",
        mimeType: "text/plain",
        byteLength: 12,
        kind: "document" as const
      }]
    };
    const preparePromptAttachments = vi.fn(async () => {
      order.push("claim");
      return attachments;
    });
    const accept = vi.fn(() => {
      order.push("accept");
      return { kind: "accepted", operationId: "operation_a" } as never;
    });
    const runtime = { preparePromptAttachments } as unknown as AgentRuntime;
    const context = { operations: () => ({ accept }) };
    const command: AgentCommand<"prompt.submit"> = {
      type: "prompt.submit",
      payload: {
        submissionId: "submission_a",
        text: "Inspect this file",
        attachments: [{ id: "draft_attachment_a" }],
        delivery: "new-turn"
      }
    };

    await dispatchHostCommand(runtime, command, context as never);

    expect(order).toEqual(["claim", "accept"]);
    expect(preparePromptAttachments).toHaveBeenCalledWith(
      "submission_a",
      [{ id: "draft_attachment_a" }]
    );
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      submissionId: "submission_a",
      kind: "prompt",
      execute: expect.any(Function)
    }));
  });

  it("does not require attachment staging for a prompt without attachments", async () => {
    const accept = vi.fn(() => ({
      kind: "accepted",
      operationId: "operation_without_attachments"
    }) as never);
    const runtime = {} as AgentRuntime;
    const context = { operations: () => ({ accept }) };

    await expect(dispatchHostCommand(runtime, {
      type: "prompt.submit",
      payload: {
        submissionId: "submission_without_attachments",
        text: "Answer without files",
        delivery: "new-turn"
      }
    }, context as never)).resolves.toEqual({
      kind: "accepted",
      operationId: "operation_without_attachments"
    });

    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      submissionId: "submission_without_attachments",
      kind: "prompt"
    }));
  });

  it("does not accept a prompt operation when attachment claim fails", async () => {
    const failure = new Error("staged attachment changed");
    const preparePromptAttachments = vi.fn().mockRejectedValue(failure);
    const accept = vi.fn();
    const runtime = { preparePromptAttachments } as unknown as AgentRuntime;
    const context = { operations: () => ({ accept }) };

    await expect(dispatchHostCommand(runtime, {
      type: "prompt.submit",
      payload: {
        submissionId: "submission_failed",
        text: "Inspect this file",
        attachments: [{ id: "draft_attachment_failed" }],
        delivery: "new-turn"
      }
    }, context as never)).rejects.toBe(failure);

    expect(accept).not.toHaveBeenCalled();
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
