import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isEnvironmentMutationRecoveryRecord, MAX_SESSION_FILE_IDENTITY_CHARS } from "@pi67/domain";
import { Value } from "../../protocol/src/typebox-schema.js";
import { ConversationPageSchema } from "../../protocol/src/message-schemas.js";
import { WorktreeCreationAdvanceResultSchema } from "../../protocol/src/worktree-creation-schema.js";
import { isWorktreeCreationAdvanceResult, parseWorktreeCreationAdvanceRequest } from "../../protocol/src/worktree-creation.js";
import { projectMessagePage } from "./message-projection.js";
import { resolveExistingSessionFileIdentity } from "./session-path-identity.js";
import { VISION_ASSISTANCE_ENTRY_TYPE } from "./vision-assistance.js";

function visualPage(attachmentExtra: Record<string, unknown> = {}) {
  return projectMessagePage({
    getSessionId: () => "session-1",
    getBranch: () => [{
      type: "custom", customType: VISION_ASSISTANCE_ENTRY_TYPE, id: "vision-1", parentId: null,
      timestamp: new Date(2).toISOString(),
      data: {
        version: 1, provider: "fixture", model: "vision", createdAt: 2,
        attachments: [{ id: "image-1", name: "fixture.png", mimeType: "image/png", byteLength: 3, ...attachmentExtra }],
        description: "A synthetic visual description",
        usage: {
          input: 20, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30,
          cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 }
        }
      }
    }]
  });
}

function recoveryRecord(sessionFileIdentity: unknown) {
  return {
    kind: "worktree-creation", creationId: "creation-1", requestId: "request-1",
    requestFingerprint: "1".repeat(64), sourceWorkspaceId: "workspace-source",
    repositoryGroupId: `repo_${"2".repeat(32)}`, worktreeToken: "a1b2c3d4e5f6g7h8",
    branchName: "pi67/task-a1b2c3d4e5f6g7h8", headSha: "3".repeat(40),
    state: "session-bound", workspaceId: "workspace-created", sessionFileIdentity,
    createdAt: 10, updatedAt: 10
  };
}

function receipt(sessionFileIdentity: unknown) {
  return { status: "advanced", receipt: {
    creationId: "creation-1", state: "session-bound", workspaceId: "workspace-created", sessionFileIdentity
  } };
}

describe("Pi projection and cross-process contracts", () => {
  it("accepts actual persisted visual evidence in a conversation page", () => {
    const page = visualPage();
    expect(page.messages[0]?.parts[0]?.type).toBe("vision-evidence");
    expect(Value.Check(ConversationPageSchema, page)).toBe(true);
  });

  it("projects only supported attachment metadata from legacy persisted records", () => {
    const page = visualPage({ legacyField: true });
    const part = page.messages[0]?.parts[0];
    expect(part?.type).toBe("vision-evidence");
    if (part?.type !== "vision-evidence") throw new Error("Missing visual evidence");
    expect(part.attachments).toEqual([
      { id: "image-1", name: "fixture.png", mimeType: "image/png", byteLength: 3 }
    ]);
    expect(Value.Check(ConversationPageSchema, page)).toBe(true);
  });

  it.each([
    { description: " " }, { totalCost: -1 }, { totalTokens: Infinity },
    { attachments: [] }, { attachments: Array.from({ length: 21 }, () => ({
      id: "image-1", name: "fixture.png", mimeType: "image/png", byteLength: 3
    })) }, { unknownField: true }
  ])("rejects malformed visual evidence %j", (patch) => {
    const page = visualPage();
    const message = page.messages[0]!;
    message.parts = [{ ...message.parts[0]!, ...patch }];
    expect(Value.Check(ConversationPageSchema, page)).toBe(false);
  });

  it("preserves actual filesystem Session identity through request, receipt and recovery", async () => {
    const identity = await resolveExistingSessionFileIdentity(fileURLToPath(import.meta.url));
    expect(identity).toContain("\0");
    for (const sessionFileIdentity of [identity, `session-file-path-v1\0/${"a/".repeat(1000)}session.jsonl`]) {
      expect(parseWorktreeCreationAdvanceRequest({
        creationId: "creation-1", targetState: "session-bound", sessionFileIdentity
      })?.sessionFileIdentity).toBe(sessionFileIdentity);
      expect(isWorktreeCreationAdvanceResult(receipt(sessionFileIdentity))).toBe(true);
      expect(Value.Check(WorktreeCreationAdvanceResultSchema, receipt(sessionFileIdentity))).toBe(true);
      const record = recoveryRecord(sessionFileIdentity);
      expect(isEnvironmentMutationRecoveryRecord(JSON.parse(JSON.stringify(record)))).toBe(true);
      expect(isEnvironmentMutationRecoveryRecord({ ...record, state: "committed" })).toBe(true);
    }
  });

  it.each(["", "a".repeat(MAX_SESSION_FILE_IDENTITY_CHARS + 1), 1, null])(
    "rejects invalid opaque identity at each Worktree boundary", (sessionFileIdentity) => {
      expect(parseWorktreeCreationAdvanceRequest({
        creationId: "creation-1", targetState: "session-bound", sessionFileIdentity
      })).toBeUndefined();
      expect(isWorktreeCreationAdvanceResult(receipt(sessionFileIdentity))).toBe(false);
      expect(Value.Check(WorktreeCreationAdvanceResultSchema, receipt(sessionFileIdentity))).toBe(false);
      expect(isEnvironmentMutationRecoveryRecord(recoveryRecord(sessionFileIdentity))).toBe(false);
    }
  );
});
