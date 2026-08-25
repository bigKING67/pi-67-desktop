import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import {
  ComposerDraftStateStore,
  parseComposerDraftPersistedState
} from "./composer-draft-state.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ComposerDraftStateStore", () => {
  it("encrypts drafts and restores the selected conversation", async () => {
    const root = await userData();
    const store = new ComposerDraftStateStore(root, { encryption: reversibleEncryption() });
    const state = draftState();
    await store.update(state);

    const serialized = await readFile(store.requestedStatePath, "utf8");
    expect(serialized).not.toContain("继续完成 Windows 会话恢复");
    expect(serialized).not.toContain(resolve("sessions/session-a.jsonl"));
    expect(serialized).toContain("encryptedState");

    await expect(new ComposerDraftStateStore(root, { encryption: reversibleEncryption() }).load())
      .resolves.toEqual({ state, persistence: "available" });
  });

  it("recovers from the backup without trusting a corrupt primary file", async () => {
    const root = await userData();
    const store = new ComposerDraftStateStore(root, { encryption: reversibleEncryption() });
    const state = draftState();
    await store.update(state);
    await writeFile(store.requestedStatePath, "{broken", "utf8");

    const restored = await new ComposerDraftStateStore(root, { encryption: reversibleEncryption() }).load();
    expect(restored).toEqual({ state, persistence: "available", recovery: "backup-restored" });
    expect(await readFile(store.requestedStatePath, "utf8")).toContain("encryptedState");
  });

  it("fails closed when safe storage is unavailable", async () => {
    const root = await userData();
    const store = new ComposerDraftStateStore(root, { encryption: unavailableEncryption() });
    const state = draftState();
    const snapshot = await store.update(state);
    expect(snapshot).toEqual({ state, persistence: "unavailable" });
    expect(await readFile(store.requestedStatePath, "utf8")).not.toContain("继续完成 Windows 会话恢复");

    await expect(new ComposerDraftStateStore(root, { encryption: unavailableEncryption() }).load())
      .resolves.toEqual({ state: { version: 1, drafts: [] }, persistence: "unavailable" });
  });

  it("does not probe safe storage for an explicitly empty draft state", async () => {
    const root = await userData();
    const isAvailable = vi.fn(() => { throw new Error("safe storage must stay lazy"); });
    const encrypt = vi.fn(() => { throw new Error("empty state must not be encrypted"); });
    const decrypt = vi.fn(() => { throw new Error("empty state must not be decrypted"); });
    const encryption: DesktopTextEncryption = {
      isAvailable,
      encrypt,
      decrypt
    };
    const store = new ComposerDraftStateStore(root, { encryption });

    await expect(store.load()).resolves.toEqual({
      state: { version: 1, drafts: [] },
      persistence: "available"
    });
    await expect(store.update({ version: 1, drafts: [] })).resolves.toEqual({
      state: { version: 1, drafts: [] },
      persistence: "available"
    });
    expect(await readFile(store.requestedStatePath, "utf8")).toContain('"emptyState":true');

    await expect(new ComposerDraftStateStore(root, { encryption }).load()).resolves.toEqual({
      state: { version: 1, drafts: [] },
      persistence: "available"
    });

    await writeFile(store.requestedStatePath, "{broken", "utf8");
    await writeFile(store.requestedBackupPath, "{broken", "utf8");
    await expect(new ComposerDraftStateStore(root, { encryption }).load()).resolves.toEqual({
      state: { version: 1, drafts: [] },
      persistence: "available",
      recovery: "corrupt-reset"
    });
    expect(isAvailable).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("removes all drafts owned by an unregistered workspace", async () => {
    const root = await userData();
    const store = new ComposerDraftStateStore(root, { encryption: reversibleEncryption() });
    await store.update({
      version: 1,
      drafts: [
        draftState().drafts[0]!,
        {
          conversation: { kind: "provisional", workspaceId: "workspace-b", draftId: "task-b" },
          text: "保留 B",
          streamBehavior: "followUp",
          updatedAt: 20
        }
      ],
      selectedConversation: draftState().selectedConversation
    });

    await store.removeWorkspace("workspace-a");
    await expect(new ComposerDraftStateStore(root, { encryption: reversibleEncryption() }).load())
      .resolves.toEqual({
        persistence: "available",
        state: {
          version: 1,
          drafts: [{
            conversation: { kind: "provisional", workspaceId: "workspace-b", draftId: "task-b" },
            text: "保留 B",
            streamBehavior: "followUp",
            updatedAt: 20
          }]
        }
      });
  });
});

describe("parseComposerDraftPersistedState", () => {
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

async function userData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-composer-draft-state-"));
  roots.push(root);
  return root;
}

function reversibleEncryption(): DesktopTextEncryption {
  return {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decrypt: (value) => value.toString("utf8").replace(/^encrypted:/u, "")
  };
}

function unavailableEncryption(): DesktopTextEncryption {
  return {
    isAvailable: () => false,
    encrypt: () => { throw new Error("Encryption is unavailable."); },
    decrypt: () => { throw new Error("Encryption is unavailable."); }
  };
}
