import { MAX_SESSION_FILE_IDENTITY_CHARS } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { Type, Value } from "./typebox-schema.js";
import { OperationSettledSchema, OperationViewSchema, operationSubmissionResultSchema } from "./operation-schemas.js";
import { TaskProtocolContextWithSessionSchema } from "./protocol-context.js";

function lifecycle(identity: string) {
  const session = { sessionId: "session", sessionFileIdentity: identity, sessionGeneration: 1 };
  const operation = { ...session, operationId: "operation", cancellable: true };
  return [
    [TaskProtocolContextWithSessionSchema, { ...session, scope: "task", workspaceId: "workspace", taskId: "task", taskGeneration: 1 }],
    [OperationViewSchema, { ...operation, kind: "prompt", lifecycle: "running", startedAt: 1 }],
    [operationSubmissionResultSchema(Type.Literal("prompt")), { ...operation, kind: "accepted", hostEpoch: 1 }],
    [OperationSettledSchema, { ...operation, kind: "settled", operationKind: "prompt", lifecycle: "completed", cancellable: false, hostEpoch: 1, startedAt: 1, settledAt: 2 }]
  ] as const;
}

describe("opaque Session physical identity across the protocol lifecycle", () => {
  it.each([
    ["metadata", "session-file-v1\0" + "1\0" + "2\0" + "3"],
    ["long fallback", "session-file-path-v1\0/tmp/" + "segment/".repeat(80) + "session.jsonl"],
    ["shared maximum", "session-file-path-v1\0".padEnd(MAX_SESSION_FILE_IDENTITY_CHARS, "x")]
  ])("accepts the same %s identity in every phase without stripping separators", (_kind, identity) => {
    for (const [schema, value] of lifecycle(identity)) expect(Value.Check(schema, value)).toBe(true);
  });

  it.each(["", "x".repeat(MAX_SESSION_FILE_IDENTITY_CHARS + 1)])("rejects empty or oversized physical identity", (identity) => {
    for (const [schema, value] of lifecycle(identity)) expect(Value.Check(schema, value)).toBe(false);
  });

  it.each(["workspaceId", "taskId", "sessionId", "operationId"])("preserves the 512-character %s boundary", (field) => {
    const [schema, context] = lifecycle("physical-identity")[0];
    expect(Value.Check(schema, { ...context, [field]: "x".repeat(512) })).toBe(true);
    expect(Value.Check(schema, { ...context, [field]: "x".repeat(513) })).toBe(false);
  });
});
