import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ApprovalRequestSchema } from "./approval-schemas.js";

describe("ApprovalRequestSchema", () => {
  it("accepts the bounded network-read category and rejects unknown categories", () => {
    const request = {
      requestId: "approval-1",
      sessionId: "session-1",
      sessionGeneration: 1,
      operationId: "operation-1",
      hostEpoch: 1,
      toolCallId: "tool-call-1",
      toolName: "web_search",
      category: "network-read",
      reason: "访问外部网络获取信息",
      targetKind: "tool",
      target: "杭州天气",
      targetTruncated: false,
      cwd: "/workspace",
      cwdTruncated: false,
      scope: "single-tool-call"
    };

    expect(Value.Check(ApprovalRequestSchema, request)).toBe(true);
    expect(Value.Check(ApprovalRequestSchema, { ...request, category: "unknown-risk" })).toBe(false);
  });
});
