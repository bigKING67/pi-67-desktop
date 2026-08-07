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
