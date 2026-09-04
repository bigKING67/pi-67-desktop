import { describe, expect, it } from "vitest";
import {
  commandEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  type ProtocolContext
} from "./envelope.js";

const CONTEXT: ProtocolContext = { scope: "workspace", workspaceId: "workspace-1" };

describe("Context Memory Experience schemas", () => {
  it("requires a structured reusable method before validating an Experience", () => {
    const payload = {
      id: "candidate-1",
      expectedUpdatedAt: 1,
      taskType: "electron-recovery",
      title: "Host recovery",
      problem: "Old Host events remain visible.",
      strategy: "Discard stale events.",
      result: "success" as const,
      confidence: 0.9,
      sensitivity: "team" as const,
      method: {
        preconditions: ["The Host epoch changed"],
        steps: ["Discard stale events"],
        tools: [],
        validationGates: ["No stale Projection remains"],
        completionCriteria: ["The active Session resumes"],
        failureModes: ["An old approval remains visible"],
        rollback: "Restore the previous Host build."
      },
      applicableWhen: ["The Host restarts"],
      notApplicableWhen: ["A normal renderer rerender occurs"],
      evidence: [],
      confirmOutcome: true as const,
      confirmRedaction: true as const
    };
    const request = commandEnvelope("experience.candidate.review", payload, CONTEXT, 1);
    expect(isRequestEnvelope(request)).toBe(true);
    const { method: _method, ...withoutMethod } = payload;
    expect(isRequestEnvelope({ ...request, payload: withoutMethod })).toBe(false);
    expect(isRequestEnvelope({
      ...request,
      payload: { ...payload, method: { ...payload.method, steps: [] } }
    })).toBe(false);
  });

  it("accepts only opaque Workspace recall feedback identifiers and bounded metric summaries", () => {
    const opaqueId = `${"a".repeat(64)}.${"b".repeat(64)}`;
    const request = commandEnvelope("context.recall.feedback", {
      id: opaqueId,
      feedback: "wrong-scope",
      sessionId: "session-1"
    }, CONTEXT, 1);
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isRequestEnvelope({
      ...request,
      payload: { ...request.payload, id: "asset-secret-name" }
    })).toBe(false);

    const metricsResult = {
      sampleCount: 12,
      p50Ms: 320,
      p95Ms: 1_100,
      automaticRecallRate: 0.5,
      toolSearchRate: 0.25,
      emptyRate: 0,
      targetP95Ms: 1_500,
      withinTarget: true
    };
    const metrics = responseEnvelope("metrics-1", 1, CONTEXT, {
      ok: true,
      type: "context.recall.metrics",
      result: metricsResult
    });
    expect(isResponseEnvelope(metrics)).toBe(true);
    expect(isResponseEnvelope({
      ...metrics,
      result: { ...metricsResult, p95Ms: -1 }
    })).toBe(false);
  });
});
