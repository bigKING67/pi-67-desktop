import { describe, expect, it } from "vitest";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope
} from "./envelope.js";

describe("accepted operation envelopes", () => {
  it("requires stable submission identities for replay-safe acknowledgements", () => {
    const operations = [
      commandEnvelope("session.import", {
        submissionId: "import-1",
        path: "/tmp/external.jsonl"
      }, APP_PROTOCOL_CONTEXT, 1),
      commandEnvelope("session.compact", { submissionId: "compact-1" }, APP_PROTOCOL_CONTEXT, 1),
      commandEnvelope("command.invoke", {
        submissionId: "command-1",
        command: "inspect"
      }, APP_PROTOCOL_CONTEXT, 1)
    ];

    for (const operation of operations) {
      expect(isRequestEnvelope(operation)).toBe(true);
      const { submissionId: _submissionId, ...withoutSubmissionId } = operation.payload;
      expect(isRequestEnvelope({ ...operation, payload: withoutSubmissionId })).toBe(false);
    }
  });

  it("validates command-specific terminal replay receipts", () => {
    const request = commandEnvelope("command.invoke", {
      submissionId: "command-1",
      command: "inspect"
    }, APP_PROTOCOL_CONTEXT, 4);
    const completed = {
      kind: "settled" as const,
      operationId: "operation-1",
      operationKind: "command" as const,
      lifecycle: "completed" as const,
      cancellable: false as const,
      hostEpoch: 4,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-1",
      sessionGeneration: 2,
      startedAt: 10,
      settledAt: 20
    };
    const response = responseEnvelope(request.requestId, 4, request.context, {
      ok: true,
      type: "command.invoke",
      result: completed
    });

    expect(isResponseEnvelope(response)).toBe(true);
    expect(isResponseEnvelope({
      ...response,
      result: { ...completed, operationKind: "compaction" }
    })).toBe(false);
    expect(isResponseEnvelope({
      ...response,
      result: { ...completed, lifecycle: "failed" }
    })).toBe(false);
    const { sessionFileIdentity: _sessionFileIdentity, ...withoutPhysicalIdentity } = completed;
    expect(isResponseEnvelope({
      ...response,
      result: withoutPhysicalIdentity
    })).toBe(false);
  });

  it("rejects Protocol v3 frames after the v4 clean break", () => {
    const request = commandEnvelope("doctor.run", {}, APP_PROTOCOL_CONTEXT, 4);
    expect(isRequestEnvelope({ ...request, protocolVersion: 3 })).toBe(false);
  });
});
