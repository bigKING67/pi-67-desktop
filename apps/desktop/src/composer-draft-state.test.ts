import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseComposerDraftPersistedState } from "./composer-draft-state.js";

describe("parseComposerDraftPersistedState", () => {
  it("accepts bounded startup runtime choices only for provisional drafts", () => {
    const provisional = {
      version: 1 as const,
      drafts: [{
        conversation: { kind: "provisional" as const, workspaceId: "workspace-a", draftId: "draft-a" },
        text: "",
        streamBehavior: "followUp" as const,
        updatedAt: 1,
        startupModel: { provider: "groland", model: "deepseek-v4-flash" },
        startupThinkingLevel: "max"
      }]
    };
    expect(parseComposerDraftPersistedState(provisional)).toEqual(provisional);
    expect(parseComposerDraftPersistedState({
      ...provisional,
      drafts: [{
        ...provisional.drafts[0],
        conversation: {
          kind: "session",
          workspaceId: "workspace-a",
          sessionFileIdentity: "session-file-a",
          sessionPath: "/sessions/a.jsonl"
        }
      }]
    })).toBeUndefined();
  });

  it("accepts the canonical NUL-delimited physical identity used by real Pi sessions", () => {
    const state = draftState();
    const conversation = {
      ...state.drafts[0]!.conversation,
      sessionFileIdentity: "session-file-v1\0device-1\0inode-1\0birthtime-1"
    };
    const canonical = {
      ...state,
      drafts: [{ ...state.drafts[0], conversation }],
      selectedConversation: conversation
    };

    expect(parseComposerDraftPersistedState(canonical)).toEqual(canonical);
  });

  it("rejects duplicate identities and selected conversations without a draft", () => {
    const state = draftState();
    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [state.drafts[0], state.drafts[0]]
    })).toBeUndefined();
    expect(parseComposerDraftPersistedState({
      ...state,
      selectedConversation: { kind: "provisional", workspaceId: "workspace-a", draftId: "missing" }
    })).toBeUndefined();
  });

  it("accepts Worktree intent only for provisional draft conversations", () => {
    const provisional = {
      version: 1 as const,
      drafts: [{
        conversation: {
          kind: "provisional" as const,
          workspaceId: "workspace-a",
          draftId: "draft-a"
        },
        text: "隔离修改",
        streamBehavior: "followUp" as const,
        updatedAt: 10,
        environmentIntent: "worktree" as const
      }]
    };
    expect(parseComposerDraftPersistedState(provisional)).toEqual(provisional);
    expect(parseComposerDraftPersistedState({
      ...draftState(),
      drafts: [{ ...draftState().drafts[0], environmentIntent: "worktree" }]
    })).toBeUndefined();
    expect(parseComposerDraftPersistedState({
      ...provisional,
      drafts: [{ ...provisional.drafts[0], environmentIntent: "remote" }]
    })).toBeUndefined();
  });

  it("accepts native interaction mode only for provisional draft conversations", () => {
    const provisional = {
      version: 1 as const,
      drafts: [{
        conversation: {
          kind: "provisional" as const,
          workspaceId: "workspace-a",
          draftId: "draft-plan"
        },
        text: "先制定计划",
        streamBehavior: "followUp" as const,
        interactionMode: "plan" as const,
        updatedAt: 11
      }]
    };
    expect(parseComposerDraftPersistedState(provisional)).toEqual(provisional);
    expect(parseComposerDraftPersistedState({
      ...draftState(),
      drafts: [{ ...draftState().drafts[0], interactionMode: "plan" }]
    })).toBeUndefined();
    expect(parseComposerDraftPersistedState({
      ...provisional,
      drafts: [{ ...provisional.drafts[0], interactionMode: "review" }]
    })).toBeUndefined();
  });

  it("accepts bounded Workspace file refs and rejects forged or duplicate identities", () => {
    const state = draftState();
    const withReference = {
      ...state,
      drafts: [{
        ...state.drafts[0],
        workspaceFiles: [{
          id: "file-a",
          revision: "revision-a",
          relativePath: "src/main.ts"
        }]
      }]
    };
    const references = withReference.drafts[0]!.workspaceFiles!;
    expect(parseComposerDraftPersistedState(withReference)).toEqual(withReference);
    expect(parseComposerDraftPersistedState({
      ...withReference,
      drafts: [{
        ...withReference.drafts[0],
        workspaceFiles: [
          ...references,
          ...references
        ]
      }]
    })).toBeUndefined();
    expect(parseComposerDraftPersistedState({
      ...withReference,
      drafts: [{
        ...withReference.drafts[0],
        workspaceFiles: [{ id: "../outside", revision: "revision-a", relativePath: "src/main.ts" }]
      }]
    })).toBeUndefined();
  });

  it("accepts bounded review-only drafts and rejects forged anchors or raw Patch fields", () => {
    const state = draftState();
    const comment = {
      id: "review-a",
      authority: {
        source: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-a",
        toolCallId: "tool-a",
        contentFingerprint: "24:abcd"
      },
      anchor: { section: "session", side: "new", startLine: 8, endLine: 8 },
      body: "Keep this error observable.",
      createdAt: 12,
      file: { id: "file-a", revision: "revision-a", relativePath: "src/main.ts" }
    };
    const reviewOnly = {
      ...state,
      drafts: [{ ...state.drafts[0], text: "", reviewComments: [comment] }]
    };
    expect(parseComposerDraftPersistedState(reviewOnly)).toEqual(reviewOnly);
    expect(parseComposerDraftPersistedState({
      ...reviewOnly,
      drafts: [{
        ...reviewOnly.drafts[0],
        reviewComments: [{ ...comment, anchor: { ...comment.anchor, startLine: 0 } }]
      }]
    })).toBeUndefined();
    expect(parseComposerDraftPersistedState({
      ...reviewOnly,
      drafts: [{
        ...reviewOnly.drafts[0],
        reviewComments: [{ ...comment, patch: "@@ -1 +1 @@" }]
      }]
    })).toBeUndefined();
  });

  it("validates Prompt stash count, identity, timestamps and global text budget", () => {
    const state = draftState();
    const stashItem = { id: "stash-1", text: "later prompt", createdAt: 10 };
    const stashOnly = {
      ...state,
      drafts: [{ ...state.drafts[0], text: "", promptStash: [stashItem] }]
    };
    expect(parseComposerDraftPersistedState(stashOnly)).toEqual(stashOnly);
    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [{ ...state.drafts[0], text: "", promptStash: [] }]
    })).toBeUndefined();

    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [{
        ...state.drafts[0],
        promptStash: Array.from({ length: 21 }, (_, index) => ({
          id: `stash-${index}`,
          text: `prompt-${index}`,
          createdAt: index
        }))
      }]
    })).toBeUndefined();
    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [{ ...state.drafts[0], promptStash: [stashItem, { ...stashItem, text: "other" }] }]
    })).toBeUndefined();
    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [{ ...state.drafts[0], promptStash: [{ ...stashItem, id: "../forged" }] }]
    })).toBeUndefined();
    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [{ ...state.drafts[0], promptStash: [{ ...stashItem, createdAt: -1 }] }]
    })).toBeUndefined();

    const largeItems = (prefix: string) => Array.from({ length: 5 }, (_, index) => ({
      id: `${prefix}-${index}`,
      text: "x".repeat(256 * 1024),
      createdAt: index
    }));
    expect(parseComposerDraftPersistedState({
      version: 1,
      drafts: [
        { ...state.drafts[0], promptStash: largeItems("a") },
        {
          ...state.drafts[0],
          conversation: {
            kind: "provisional",
            workspaceId: "workspace-a",
            draftId: "stash-draft-b"
          },
          promptStash: largeItems("b")
        }
      ]
    })).toBeUndefined();
  });

  it("accepts legacy text and bounded image metadata while rejecting forged image state", () => {
    const state = draftState();
    const image = {
      blobId: "blob-1",
      name: "screen.png",
      mimeType: "image/png" as const,
      byteLength: 4,
      kind: "image" as const
    };
    const imageOnly = {
      ...state,
      drafts: [{
        ...state.drafts[0],
        text: "",
        promptStash: [{ id: "stash-image", text: "", createdAt: 12, attachments: [image] }]
      }]
    };
    expect(parseComposerDraftPersistedState(imageOnly)).toEqual(imageOnly);
    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [{
        ...state.drafts[0],
        promptStash: [{ id: "legacy", text: "legacy text", createdAt: 1 }]
      }]
    })).toBeDefined();

    for (const attachment of [
      { ...image, blobId: "../outside" },
      { ...image, name: "nested/screen.png" },
      { ...image, mimeType: "image/svg+xml" },
      { ...image, kind: "document" },
      { ...image, data: "iVBORw==" }
    ]) {
      expect(parseComposerDraftPersistedState({
        ...imageOnly,
        drafts: [{
          ...imageOnly.drafts[0],
          promptStash: [{ id: "stash-image", text: "image", createdAt: 12, attachments: [attachment] }]
        }]
      })).toBeUndefined();
    }
    expect(parseComposerDraftPersistedState({
      ...imageOnly,
      drafts: [{
        ...imageOnly.drafts[0],
        promptStash: [{ id: "stash-image", text: "image", createdAt: 12, attachments: [image, image] }]
      }]
    })).toBeUndefined();
  });

  it("enforces per-item, per-task, and global Prompt stash image quotas from metadata", () => {
    const state = draftState();
    const image = (id: string, byteLength = 32 * 1024 * 1024) => ({
      blobId: id,
      name: `${id}.png`,
      mimeType: "image/png",
      byteLength,
      kind: "image"
    });
    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [{
        ...state.drafts[0],
        promptStash: [{
          id: "stash-overflow",
          text: "overflow",
          createdAt: 1,
          attachments: [image("blob-overflow", 32 * 1024 * 1024 + 1)]
        }]
      }]
    })).toBeUndefined();

    const stashes = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-stash-${index}`,
      text: "image",
      createdAt: index,
      attachments: [image(`${prefix}-blob-${index}`)]
    }));
    expect(parseComposerDraftPersistedState({
      ...state,
      drafts: [{ ...state.drafts[0], promptStash: stashes("task", 5) }]
    })).toBeUndefined();

    expect(parseComposerDraftPersistedState({
      version: 1,
      drafts: Array.from({ length: 5 }, (_, index) => ({
        conversation: {
          kind: "provisional",
          workspaceId: "workspace-a",
          draftId: `draft-${index}`
        },
        text: "",
        streamBehavior: "followUp",
        updatedAt: index,
        promptStash: stashes(`global-${index}`, 4)
      }))
    })).toBeUndefined();
  });
});

function draftState() {
  const conversation = {
    kind: "session" as const,
    workspaceId: "workspace-a",
    sessionFileIdentity: "session-file-a",
    sessionPath: resolve("sessions/session-a.jsonl")
  };
  return {
    version: 1 as const,
    drafts: [{
      conversation,
      text: "继续完成 Windows 会话恢复",
      streamBehavior: "followUp" as const,
      updatedAt: 10
    }],
    selectedConversation: conversation
  };
}
