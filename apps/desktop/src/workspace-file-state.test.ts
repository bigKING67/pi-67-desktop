import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFileStateStore, type WorkspaceFileEncryption } from "./workspace-file-state.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorkspaceFileStateStore", () => {
  it("encrypts dirty drafts while preserving clean tab metadata", async () => {
    const root = await userData();
    const store = new WorkspaceFileStateStore(root, { encryption: reversibleEncryption() });
    const snapshot = await store.update({
      version: 1,
      workspaces: [{
        workspaceId: "workspace-1",
        activeRelativePath: "src/main.ts",
        tabs: [
          { relativePath: "README.md" },
          { relativePath: "src/main.ts", baseRevision: "revision_1", draft: "private source draft" }
        ]
      }]
    });
    expect(snapshot.draftPersistence).toBe("available");
    const serialized = await readFile(store.requestedStatePath, "utf8");
    expect(serialized).not.toContain("private source draft");
    expect(serialized).toContain("encryptedDraft");

    const restored = await new WorkspaceFileStateStore(root, { encryption: reversibleEncryption() }).load();
    expect(restored.state.workspaces[0]?.tabs[1]).toEqual({
      relativePath: "src/main.ts",
      baseRevision: "revision_1",
      draft: "private source draft"
    });
  });

  it("fails closed without encryption and quarantines corrupt state", async () => {
    const root = await userData();
    const unavailable = new WorkspaceFileStateStore(root, { encryption: unavailableEncryption() });
    const snapshot = await unavailable.update({
      version: 1,
      workspaces: [{
        workspaceId: "workspace-1",
        activeRelativePath: "notes.md",
        tabs: [{ relativePath: "notes.md", baseRevision: "revision_1", draft: "runtime-only" }]
      }]
    });
    expect(snapshot.draftPersistence).toBe("unavailable");
    await expect(readFile(unavailable.requestedStatePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const corrupt = new WorkspaceFileStateStore(root, { encryption: reversibleEncryption() });
    await corrupt.update({ version: 1, workspaces: [] });
    await writeFile(unavailable.requestedStatePath, "{broken", "utf8");
    const restored = await new WorkspaceFileStateStore(root, { encryption: reversibleEncryption() }).load();
    expect(restored).toMatchObject({ state: { version: 1, workspaces: [] }, recovery: "corrupt-reset" });
  });

  it("preserves encrypted dirty drafts when a later write cannot access safe storage", async () => {
    const root = await userData();
    const original = new WorkspaceFileStateStore(root, { encryption: reversibleEncryption() });
    const state = {
      version: 1 as const,
      workspaces: [{
        workspaceId: "workspace-1",
        tabs: [{ relativePath: "notes.md", baseRevision: "revision_1", draft: "encrypted original" }]
      }]
    };
    await original.update(state);
    const encrypted = await readFile(original.requestedStatePath, "utf8");

    const unavailable = new WorkspaceFileStateStore(root, { encryption: unavailableEncryption() });
    const next = structuredClone(state);
    next.workspaces[0]!.tabs[0]!.draft = "runtime-only replacement";
    await expect(unavailable.update(next)).resolves.toEqual({
      state: next,
      draftPersistence: "unavailable"
    });
    expect(await readFile(original.requestedStatePath, "utf8")).toBe(encrypted);
  });

  it("does not probe safe storage until a Workspace file has a dirty draft", async () => {
    const root = await userData();
    const isAvailable = vi.fn(() => { throw new Error("safe storage must stay lazy"); });
    const encrypt = vi.fn(() => { throw new Error("empty state must not be encrypted"); });
    const decrypt = vi.fn(() => { throw new Error("empty state must not be decrypted"); });
    const encryption = { isAvailable, encrypt, decrypt };
    const store = new WorkspaceFileStateStore(root, { encryption });

    await expect(store.load()).resolves.toEqual({
      state: { version: 1, workspaces: [] },
      draftPersistence: "available"
    });
    const cleanState = {
      version: 1 as const,
      workspaces: [{
        workspaceId: "workspace-clean",
        activeRelativePath: "README.md",
        tabs: [{ relativePath: "README.md" }]
      }]
    };
    await expect(store.update(cleanState)).resolves.toEqual({
      state: cleanState,
      draftPersistence: "available"
    });
    await expect(new WorkspaceFileStateStore(root, { encryption }).load()).resolves.toEqual({
      state: cleanState,
      draftPersistence: "available"
    });
    expect(isAvailable).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });
});

async function userData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-workspace-file-state-"));
  roots.push(root);
  return root;
}

function reversibleEncryption(): WorkspaceFileEncryption {
  return {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decrypt: (value) => value.toString("utf8").replace(/^encrypted:/u, "")
  };
}

function unavailableEncryption(): WorkspaceFileEncryption {
  return {
    isAvailable: () => false,
    encrypt: () => { throw new Error("Encryption is unavailable."); },
    decrypt: () => { throw new Error("Encryption is unavailable."); }
  };
}
