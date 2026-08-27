import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import { ComposerDraftStateStore } from "./composer-draft-state.js";

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
    await expect(readFile(store.requestedStatePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await expect(new ComposerDraftStateStore(root, { encryption: unavailableEncryption() }).load())
      .resolves.toEqual({ state: { version: 1, drafts: [] }, persistence: "available" });
  });

  it("preserves the last encrypted state when a later write cannot access safe storage", async () => {
    const root = await userData();
    const original = new ComposerDraftStateStore(root, { encryption: reversibleEncryption() });
    await original.update(draftState());
    const encrypted = await readFile(original.requestedStatePath, "utf8");

    const unavailable = new ComposerDraftStateStore(root, { encryption: unavailableEncryption() });
    const next = {
      ...draftState(),
      drafts: [{ ...draftState().drafts[0]!, text: "new runtime-only draft" }]
    };
    await expect(unavailable.update(next)).resolves.toEqual({
      state: next,
      persistence: "unavailable"
    });
    expect(await readFile(original.requestedStatePath, "utf8")).toBe(encrypted);
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
