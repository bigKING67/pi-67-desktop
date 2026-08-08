import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
