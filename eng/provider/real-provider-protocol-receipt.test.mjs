import { describe, expect, it } from "vitest";
import {
  createRealProviderProtocolProbe,
  reduceRealProviderProtocolEnvelope,
  sanitizeRealProviderProtocolProbe
} from "./real-provider-protocol-receipt.mjs";

describe("real Provider protocol receipt", () => {
  it("reduces only acknowledgement and matching terminal identity fields", () => {
    const initial = {
      ...createRealProviderProtocolProbe(),
      hostEpoch: 7,
      submitStartedAt: 1_000
    };
    const accepted = reduceRealProviderProtocolEnvelope(initial, {
      kind: "response",
      type: "prompt.submit",
      ok: true,
      result: {
        kind: "accepted",
        operationId: "operation-1",
        prompt: "must-not-cross",
        apiKey: "must-not-cross"
      }
    }, 1_120);
    const controlled = reduceRealProviderProtocolEnvelope(accepted, {
      kind: "response",
      type: "model.select",
      ok: true,
      result: { sourceBody: "must-not-cross" }
    }, 1_130);
    const terminal = reduceRealProviderProtocolEnvelope(controlled, {
      kind: "event",
      type: "operation.completed",
      sequence: 9,
      payload: {
        operationId: "operation-1",
        rawToolPayload: "must-not-cross",
        sourceBody: "must-not-cross"
      }
    }, 101_120);

    expect(terminal).toEqual({
      hostEpoch: 7,
      submitStartedAt: 1_000,
      acceptedAt: 1_120,
      operationId: "operation-1",
      approval: undefined,
      controlResponses: { "model.select": true },
      terminal: {
        type: "operation.completed",
        at: 101_120,
        sequence: 9
      }
    });
    expect(JSON.stringify(terminal)).not.toContain("must-not-cross");
  });

  it("captures only bounded approval authority fields", () => {
    const accepted = reduceRealProviderProtocolEnvelope(createRealProviderProtocolProbe(), {
      kind: "response",
      type: "prompt.submit",
      ok: true,
      result: { kind: "accepted", operationId: "operation-1" }
    }, 1_000);
    const approval = reduceRealProviderProtocolEnvelope(accepted, {
      kind: "event",
      type: "approval.requested",
      sequence: 8,
      payload: {
        hostEpoch: 7,
        requestId: "approval-1",
        toolCallId: "tool-call-1",
        operationId: "operation-1",
        toolName: "pi67_long_turn_probe",
        targetKind: "tool",
        target: "pi67_long_turn_probe",
        targetTruncated: false,
        cwd: "C:\\runner\\provider-workspace",
        cwdTruncated: false,
        scope: "single-tool-call",
        prompt: "must-not-cross",
        sourceBody: "must-not-cross"
      }
    }, 1_100);

    expect(approval.approval).toEqual({
      sequence: 8,
      hostEpoch: 7,
      requestId: "approval-1",
      toolCallId: "tool-call-1",
      operationId: "operation-1",
      toolName: "pi67_long_turn_probe",
      targetKind: "tool",
      target: "pi67_long_turn_probe",
      targetTruncated: false,
      cwd: "C:\\runner\\provider-workspace",
      cwdTruncated: false,
      scope: "single-tool-call"
    });
    expect(JSON.stringify(approval)).not.toContain("must-not-cross");
  });

  it("ignores unrelated terminals and strips arbitrary probe fields", () => {
    const probe = sanitizeRealProviderProtocolProbe({
      hostEpoch: 3,
      submitStartedAt: 1_000,
      acceptedAt: 1_100,
      operationId: "operation-1",
      apiKey: "must-not-cross",
      prompt: "must-not-cross"
    });
    const reduced = reduceRealProviderProtocolEnvelope(probe, {
      kind: "event",
      type: "operation.failed",
      sequence: 4,
      payload: { operationId: "operation-2" }
    }, 2_000);

    expect(reduced.terminal).toBeUndefined();
    expect(reduced.controlResponses).toEqual({});
    expect(JSON.stringify(reduced)).not.toContain("must-not-cross");
  });
});
