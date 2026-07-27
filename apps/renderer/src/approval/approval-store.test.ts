import type { ApprovalRequestView } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { useApprovalStore } from "./approval-store.js";

const request: ApprovalRequestView = {
  requestId: "approval-1",
  toolCallId: "tool-1",
  toolName: "bash",
  category: "ambiguous-command",
  reason: "Confirm",
  targetKind: "command",
  target: "pnpm test",
  targetTruncated: false,
  cwd: "/workspace",
  cwdTruncated: false,
  scope: "single-tool-call",
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

describe("approvalStore", () => {
  beforeEach(() => {
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  });

  it("upserts requests in place and removes only matching identities", () => {
    const store = useApprovalStore.getState();
    store.upsertRequest(request);
    store.upsertRequest({ ...request, reason: "Updated" });
    store.upsertRequest({ ...request, requestId: "approval-2", toolCallId: "tool-2" });

    expect(useApprovalStore.getState().requests).toEqual([
      { ...request, reason: "Updated" },
      { ...request, requestId: "approval-2", toolCallId: "tool-2" }
    ]);
    store.removeRequests(["approval-1", "unknown"]);
    expect(useApprovalStore.getState().requests.map((item) => item.requestId)).toEqual(["approval-2"]);
    store.removeRequest("approval-2");
    expect(useApprovalStore.getState().requests).toEqual([]);
  });

  it("resets transient requests without replacing stable action identities", () => {
    const actions = useApprovalStore.getState();
    actions.upsertRequest(request);
    actions.reset();

    const reset = useApprovalStore.getState();
    expect(reset.requests).toEqual([]);
    expect(reset.upsertRequest).toBe(actions.upsertRequest);
    expect(reset.reset).toBe(actions.reset);
  });
});
