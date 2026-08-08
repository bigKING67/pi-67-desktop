import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM } from "@pi67/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import {
  PromptAttachmentStagingService,
  type PromptStagedImagePayload
} from "./prompt-attachment-staging.js";
import { PromptStashImageStore } from "./prompt-stash-image-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PromptStashImageStore", () => {
  it("fails closed when OS-backed encryption is unavailable", async () => {
    const fixture = await createFixture(unavailableEncryption());
    const attachmentId = await stagePng(fixture.staging, "source.png", [1, 2, 3, 4]);

    await expect(fixture.store.store(request("stash-a", [attachmentId])))
      .rejects.toThrow("encryption is unavailable");
    await expect(access(fixture.store.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("encrypts image bytes, restores SHA-identical bytes under fresh ids, and deletes by ownership", async () => {
    const fixture = await createFixture(reversibleEncryption());
    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const attachmentId = await stagePng(fixture.staging, "source.png", [1, 2, 3, 4]);

    const stored = await fixture.store.store(request("stash-a", [attachmentId]));
    expect(stored).toEqual({
      itemId: "stash-a",
      attachments: [{
        blobId: expect.stringMatching(/^img_/u),
        name: "source.png",
        mimeType: "image/png",
        byteLength: raw.byteLength,
        kind: "image"
      }]
    });
    const itemDirectory = join(fixture.store.root, "stash-a");
    const manifest = await readFile(join(itemDirectory, "manifest.json"), "utf8");
    expect(manifest).not.toContain('"data"');
    expect(manifest).not.toContain('"path"');
    const encrypted = await readFile(join(itemDirectory, `${stored.attachments[0]!.blobId}.bin`));
    expect(encrypted.indexOf(raw)).toBe(-1);
    expect(encrypted.toString("utf8")).not.toContain(raw.toString("base64"));

    const restored = await fixture.store.restore({ taskId: "task-a", itemId: "stash-a" });
    expect(restored.attachments[0]?.id).not.toBe(attachmentId);
    const [restoredPayload] = await fixture.staging.readDraftImages([restored.attachments[0]!.id]);
    expect(restoredPayload?.bytes).toEqual(raw);

    await expect(fixture.store.delete({ taskId: "task-b", itemId: "stash-a" }))
      .rejects.toThrow("ownership does not match");
    await expect(fixture.store.delete({ taskId: "task-a", itemId: "stash-a" })).resolves.toBeUndefined();
    await expect(access(itemDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("enforces per-item, per-task, and global quotas before writing encrypted payloads", async () => {
    const root = await temporaryRoot("pi67-prompt-stash-quota-");
    const oversizedStaging = {
      readDraftImages: async (): Promise<PromptStagedImagePayload[]> => [{
        id: "attachment-a",
        name: "large.png",
        mimeType: "image/png",
        byteLength: MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM + 1,
        kind: "image",
        bytes: Buffer.from([1])
      }]
    } as unknown as PromptAttachmentStagingService;
    const oversized = new PromptStashImageStore(join(root, "oversized"), {
      encryption: reversibleEncryption(),
      staging: oversizedStaging
    });
    await expect(oversized.store(request("stash-overflow", ["attachment-a"])))
      .rejects.toThrow("32 MiB per-item limit");

    const taskFixture = await createFixture(reversibleEncryption(), join(root, "task"));
    await taskFixture.store.reconcile(new Set());
    for (let index = 0; index < 4; index += 1) {
      await seedManifest(taskFixture.store.root, {
        workspaceId: "workspace-a",
        taskId: "task-a",
        itemId: `task-seed-${index}`,
        blobId: `task-blob-${index}`,
        byteLength: MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM
      });
    }
    const taskAttachment = await stagePng(taskFixture.staging, "task.png", [1]);
    await expect(taskFixture.store.store(request("task-overflow", [taskAttachment])))
      .rejects.toThrow("128 MiB per-task limit");

    const globalFixture = await createFixture(reversibleEncryption(), join(root, "global"));
    await globalFixture.store.reconcile(new Set());
    for (let index = 0; index < 16; index += 1) {
      await seedManifest(globalFixture.store.root, {
        workspaceId: "workspace-a",
        taskId: `task-${index}`,
        itemId: `global-seed-${index}`,
        blobId: `global-blob-${index}`,
        byteLength: MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM
      });
    }
    const globalAttachment = await stagePng(globalFixture.staging, "global.png", [1]);
    await expect(globalFixture.store.store({
      ...request("global-overflow", [globalAttachment]),
      taskId: "task-new"
    })).rejects.toThrow("512 MiB global limit");
  });

  it("removes temporary and orphaned items during reconciliation without touching referenced items", async () => {
    const fixture = await createFixture(reversibleEncryption());
    const attachmentId = await stagePng(fixture.staging, "source.png", [1, 2]);
    await fixture.store.store(request("stash-keep", [attachmentId]));
    await fixture.store.store(request("stash-orphan", [attachmentId]));
    await mkdir(join(fixture.store.root, ".tmp-crash"));
    await writeFile(join(fixture.store.root, "unexpected-file"), "invalid", "utf8");

    await expect(fixture.store.reconcile(new Set(["stash-keep"]))).resolves.toEqual({ removed: 3 });
    expect(await readdir(fixture.store.root)).toEqual(["stash-keep"]);
  });

  it("cleans a partially encrypted temporary item when storage fails", async () => {
    let encryptions = 0;
    const encryption = reversibleEncryption();
    const fixture = await createFixture({
      ...encryption,
      encrypt(value) {
        encryptions += 1;
        if (encryptions === 2) throw new Error("synthetic encryption failure");
        return encryption.encrypt(value);
      }
    });
    const first = await stagePng(fixture.staging, "first.png", [1]);
    const second = await stagePng(fixture.staging, "second.png", [2]);

    await expect(fixture.store.store(request("stash-failed", [first, second])))
      .rejects.toThrow("synthetic encryption failure");
    expect(await readdir(fixture.store.root)).toEqual([]);
  });

  it("removes only the requested Workspace and rejects corrupt encrypted state", async () => {
    const fixture = await createFixture(reversibleEncryption());
    const attachmentId = await stagePng(fixture.staging, "source.png", [1, 2, 3]);
    await fixture.store.store(request("stash-a", [attachmentId]));
    await fixture.store.store({ ...request("stash-b", [attachmentId]), workspaceId: "workspace-b", taskId: "task-b" });

    await fixture.store.removeWorkspace("workspace-a");
    expect(await readdir(fixture.store.root)).toEqual(["stash-b"]);
    const manifest = JSON.parse(await readFile(join(fixture.store.root, "stash-b", "manifest.json"), "utf8")) as {
      attachments: { blobId: string }[];
    };
    await writeFile(
      join(fixture.store.root, "stash-b", `${manifest.attachments[0]!.blobId}.bin`),
      Buffer.from("corrupt")
    );
    await expect(fixture.store.restore({ taskId: "task-b", itemId: "stash-b" })).rejects.toThrow();
  });

  it("rejects a symlinked Workbench storage parent and stops accepting work after dispose", async () => {
    const fixture = await createFixture(reversibleEncryption());
    fixture.store.dispose();
    expect(fixture.store.diagnostics()).toEqual({ disposed: true });
    await expect(fixture.store.reconcile(new Set())).rejects.toThrow("shutting down");

    if (process.platform === "win32") return;
    const root = await temporaryRoot("pi67-prompt-stash-symlink-");
    const outside = join(root, "outside");
    const userData = join(root, "user-data");
    await Promise.all([mkdir(outside), mkdir(userData)]);
    await symlink(outside, join(userData, "workbench"), "dir");
    const store = new PromptStashImageStore(userData, {
      encryption: reversibleEncryption(),
      staging: new PromptAttachmentStagingService(join(root, "staging"))
    });
    await expect(store.reconcile(new Set())).rejects.toThrow("storage path is invalid");
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects forged direct-call identities before they can escape the store", async () => {
    const fixture = await createFixture(reversibleEncryption());
    await expect(fixture.store.delete({ taskId: "task-a", itemId: "../outside" }))
      .rejects.toThrow("identity is invalid");
    await expect(fixture.store.removeWorkspace("../outside"))
      .rejects.toThrow("identity is invalid");
  });
});

async function createFixture(
  encryption: DesktopTextEncryption,
  parent?: string
): Promise<{
  staging: PromptAttachmentStagingService;
  store: PromptStashImageStore;
}> {
  const fixtureRoot = parent ?? await temporaryRoot("pi67-prompt-stash-image-");
  const staging = new PromptAttachmentStagingService(join(fixtureRoot, "staging"));
  let token = 0;
  return {
    staging,
    store: new PromptStashImageStore(join(fixtureRoot, "user-data"), {
      encryption,
      staging,
      now: () => 123,
      createToken: () => `token-${++token}`
    })
  };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function stagePng(
  staging: PromptAttachmentStagingService,
  name: string,
  body: readonly number[]
): Promise<string> {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...body]);
  const [attachment] = await staging.stage([{
    name,
    mimeType: "image/png",
    byteLength: bytes.byteLength,
    lastModified: 0,
    data: bytes.buffer
  }]);
  if (!attachment) throw new Error("Expected a staged PNG.");
  return attachment.id;
}

function request(itemId: string, attachmentIds: string[]) {
  return {
    workspaceId: "workspace-a",
    taskId: "task-a",
    itemId,
    attachmentIds
  };
}

async function seedManifest(root: string, seed: {
  workspaceId: string;
  taskId: string;
  itemId: string;
  blobId: string;
  byteLength: number;
}): Promise<void> {
  const directory = join(root, seed.itemId);
  await mkdir(directory);
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify({
    version: 1,
    workspaceId: seed.workspaceId,
    taskId: seed.taskId,
    itemId: seed.itemId,
    createdAt: 1,
    attachments: [{
      blobId: seed.blobId,
      name: `${seed.blobId}.png`,
      mimeType: "image/png",
      byteLength: seed.byteLength,
      kind: "image",
      sha256: "0".repeat(64)
    }]
  })}\n`, "utf8");
}

function reversibleEncryption(): DesktopTextEncryption {
  return {
    isAvailable: () => true,
    encrypt(value) {
      return Buffer.from([...Buffer.from(value, "utf8")].map((byte) => byte ^ 0xa5));
    },
    decrypt(value) {
      return Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString("utf8");
    }
  };
}

function unavailableEncryption(): DesktopTextEncryption {
  return {
    isAvailable: () => false,
    encrypt: () => { throw new Error("unavailable"); },
    decrypt: () => { throw new Error("unavailable"); }
  };
}
