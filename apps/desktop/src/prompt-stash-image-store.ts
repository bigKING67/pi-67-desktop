import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath as realpathNative,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM,
  MAX_PROMPT_STASH_IMAGE_BYTES_PER_TASK,
  MAX_PROMPT_STASH_IMAGE_BYTES_TOTAL,
  type PromptStashImageRef,
  type PromptStashImagesRestoreResult,
  type PromptStashImagesStoreRequest,
  type PromptStashImagesStoreResult
} from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import type { PromptAttachmentStagingService } from "./prompt-attachment-staging.js";
import { WORKBENCH_STATE_DIRECTORY } from "./workbench-state-contract.js";

const DIRECTORY_NAME = "prompt-stash-images-v1";
const MANIFEST_NAME = "manifest.json";
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_STORE_ENTRIES = 4_000;

interface StoredImage extends PromptStashImageRef {
  sha256: string;
}

interface StoredItemManifest {
  version: 1;
  workspaceId: string;
  taskId: string;
  itemId: string;
  createdAt: number;
  attachments: StoredImage[];
}

export class PromptStashImageStore {
  readonly root: string;
  readonly #requestedUserData: string;
  readonly #encryption: DesktopTextEncryption;
  readonly #staging: PromptAttachmentStagingService;
  readonly #now: () => number;
  readonly #createToken: () => string;
  #pending: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(userData: string, options: {
    encryption: DesktopTextEncryption;
    staging: PromptAttachmentStagingService;
    now?: () => number;
    createToken?: () => string;
  }) {
    this.#requestedUserData = resolve(userData);
    this.root = join(this.#requestedUserData, WORKBENCH_STATE_DIRECTORY, DIRECTORY_NAME);
    this.#encryption = options.encryption;
    this.#staging = options.staging;
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
  }

  store(request: PromptStashImagesStoreRequest): Promise<PromptStashImagesStoreResult> {
    return this.#enqueue(async () => {
      this.#assertAvailable();
      const workspaceId = assertOpaqueId(request.workspaceId, "workspace");
      const taskId = assertOpaqueId(request.taskId, "task");
      const itemId = assertOpaqueId(request.itemId, "item");
      const attachmentIds = request.attachmentIds.map((id) => assertOpaqueId(id, "attachment"));
      if (attachmentIds.length === 0 || new Set(attachmentIds).size !== attachmentIds.length) {
        throw new Error("Prompt Stash image attachments are invalid.");
      }
      const directory = await this.#ensureRoot();
      const finalPath = join(directory, itemId);
      if (await pathExists(finalPath)) throw new Error("Prompt Stash image item already exists.");
      const payloads = await this.#staging.readDraftImages(attachmentIds);
      const itemBytes = payloads.reduce((total, payload) => total + payload.byteLength, 0);
      if (itemBytes > MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM) {
        throw new Error("Prompt Stash images exceed the 32 MiB per-item limit.");
      }
      const manifests = await this.#readAllManifests(directory);
      const taskBytes = manifests
        .filter((manifest) => manifest.taskId === taskId)
        .reduce((total, manifest) => total + manifestBytes(manifest), 0);
      const globalBytes = manifests.reduce((total, manifest) => total + manifestBytes(manifest), 0);
      if (taskBytes + itemBytes > MAX_PROMPT_STASH_IMAGE_BYTES_PER_TASK) {
        throw new Error("Prompt Stash images exceed the 128 MiB per-task limit.");
      }
      if (globalBytes + itemBytes > MAX_PROMPT_STASH_IMAGE_BYTES_TOTAL) {
        throw new Error("Prompt Stash images exceed the 512 MiB global limit.");
      }

      const temporaryPath = join(directory, `.tmp-${assertOpaqueId(this.#createToken(), "temporary")}`);
      await mkdir(temporaryPath, { mode: 0o700 });
      try {
        const attachments: StoredImage[] = [];
        for (const payload of payloads) {
          const blobId = assertOpaqueId(`img_${this.#createToken().replaceAll("-", "_")}`, "blob");
          const encrypted = this.#encryption.encrypt(payload.bytes.toString("base64"));
          await writeFile(join(temporaryPath, `${blobId}.bin`), encrypted, { flag: "wx", mode: 0o600 });
          attachments.push({
            blobId,
            name: payload.name,
            mimeType: payload.mimeType as StoredImage["mimeType"],
            byteLength: payload.byteLength,
            kind: "image",
            sha256: createHash("sha256").update(payload.bytes).digest("hex")
          });
        }
        const manifest: StoredItemManifest = {
          version: 1,
          workspaceId,
          taskId,
          itemId,
          createdAt: this.#now(),
          attachments
        };
        await writeFile(
          join(temporaryPath, `${MANIFEST_NAME}.tmp`),
          `${JSON.stringify(manifest)}\n`,
          { flag: "wx", mode: 0o600 }
        );
        await rename(join(temporaryPath, `${MANIFEST_NAME}.tmp`), join(temporaryPath, MANIFEST_NAME));
        await rename(temporaryPath, finalPath);
        return {
          itemId,
          attachments: attachments.map(publicImage)
        };
      } catch (error) {
        await rm(temporaryPath, { recursive: true, force: true });
        throw error;
      }
    });
  }

  restore(request: { taskId: string; itemId: string }): Promise<PromptStashImagesRestoreResult> {
    return this.#enqueue(async () => {
      this.#assertAvailable();
      const taskId = assertOpaqueId(request.taskId, "task");
      const itemId = assertOpaqueId(request.itemId, "item");
      const directory = await this.#ensureRoot();
      const manifest = await this.#readOwnedManifest(directory, taskId, itemId);
      const images = [];
      for (const attachment of manifest.attachments) {
        const encrypted = await readBoundedRegularFile(
          join(directory, manifest.itemId, `${attachment.blobId}.bin`),
          Math.ceil(attachment.byteLength * 2) + 1024 * 1024
        );
        let encoded: string;
        try {
          encoded = this.#encryption.decrypt(encrypted);
        } catch {
          throw new Error("Prompt Stash image could not be decrypted.");
        }
        if (!isCanonicalBase64(encoded)) throw new Error("Prompt Stash image payload is invalid.");
        const bytes = Buffer.from(encoded, "base64");
        if (
          bytes.byteLength !== attachment.byteLength
          || createHash("sha256").update(bytes).digest("hex") !== attachment.sha256
        ) throw new Error("Prompt Stash image failed integrity validation.");
        images.push({ name: attachment.name, mimeType: attachment.mimeType, bytes });
      }
      return {
        itemId,
        attachments: await this.#staging.stageStoredImages(images)
      };
    });
  }

  delete(request: { taskId: string; itemId: string }): Promise<void> {
    return this.#enqueue(async () => {
      const taskId = assertOpaqueId(request.taskId, "task");
      const itemId = assertOpaqueId(request.itemId, "item");
      const directory = await this.#ensureRoot();
      const itemPath = join(directory, itemId);
      if (!await pathExists(itemPath)) return;
      await this.#readOwnedManifest(directory, taskId, itemId);
      await rm(itemPath, { recursive: true, force: true });
    });
  }

  reconcile(referencedItemIds: ReadonlySet<string>): Promise<{ removed: number }> {
    return this.#enqueue(async () => {
      const directory = await this.#ensureRoot();
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length > MAX_STORE_ENTRIES) throw new Error("Prompt Stash image store exceeds its entry limit.");
      let removed = 0;
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.name.startsWith(".tmp-") || !entry.isDirectory() || entry.isSymbolicLink()) {
          await rm(path, { recursive: true, force: true });
          removed += 1;
          continue;
        }
        const manifest = await this.#readManifest(path).catch(() => undefined);
        if (!manifest || !referencedItemIds.has(manifest.itemId) || entry.name !== manifest.itemId) {
          await rm(path, { recursive: true, force: true });
          removed += 1;
        }
      }
      return { removed };
    });
  }

  removeWorkspace(workspaceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const ownedWorkspaceId = assertOpaqueId(workspaceId, "workspace");
      const directory = await this.#ensureRoot();
      for (const manifest of await this.#readAllManifests(directory)) {
        if (manifest.workspaceId === ownedWorkspaceId) {
          await rm(join(directory, manifest.itemId), { recursive: true, force: true });
        }
      }
    });
  }

  diagnostics(): { disposed: boolean } {
    return { disposed: this.#disposed };
  }

  dispose(): void {
    this.#disposed = true;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#disposed) return Promise.reject(new Error("Prompt Stash image store is shutting down."));
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  #assertAvailable(): void {
    if (!this.#encryption.isAvailable()) {
      throw new Error("Prompt Stash image encryption is unavailable on this system.");
    }
  }

  async #ensureRoot(): Promise<string> {
    await mkdir(this.#requestedUserData, { recursive: true, mode: 0o700 });
    const canonicalUserData = await realpathNative(this.#requestedUserData);
    const workbenchDirectory = await ensureRealDirectory(canonicalUserData, WORKBENCH_STATE_DIRECTORY);
    assertContained(canonicalUserData, workbenchDirectory);
    const directory = await ensureRealDirectory(workbenchDirectory, DIRECTORY_NAME);
    assertContained(canonicalUserData, directory);
    if (process.platform !== "win32") await chmod(directory, 0o700);
    return directory;
  }

  async #readOwnedManifest(root: string, taskId: string, itemId: string): Promise<StoredItemManifest> {
    const manifest = await this.#readManifest(join(root, itemId));
    if (manifest.itemId !== itemId || manifest.taskId !== taskId) {
      throw new Error("Prompt Stash image ownership does not match the request.");
    }
    return manifest;
  }

  async #readAllManifests(directory: string): Promise<StoredItemManifest[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > MAX_STORE_ENTRIES) throw new Error("Prompt Stash image store exceeds its entry limit.");
    const manifests: StoredItemManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".tmp-")) continue;
      const manifest = await this.#readManifest(join(directory, entry.name));
      if (manifest.itemId !== entry.name) throw new Error("Prompt Stash image manifest identity is invalid.");
      manifests.push(manifest);
    }
    return manifests;
  }

  async #readManifest(directory: string): Promise<StoredItemManifest> {
    const directoryMetadata = await lstat(directory);
    if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
      throw new Error("Prompt Stash item is not a real directory.");
    }
    const value = JSON.parse((await readBoundedRegularFile(join(directory, MANIFEST_NAME), MAX_MANIFEST_BYTES)).toString("utf8")) as unknown;
    const manifest = parseManifest(value);
    if (!manifest) throw new Error("Prompt Stash image manifest is invalid.");
    return manifest;
  }
}

function parseManifest(value: unknown): StoredItemManifest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "workspaceId", "taskId", "itemId", "createdAt", "attachments"])) return undefined;
  if (
    value.version !== 1
    || !isOpaqueId(value.workspaceId)
    || !isOpaqueId(value.taskId)
    || !isOpaqueId(value.itemId)
    || !Number.isSafeInteger(value.createdAt)
    || Number(value.createdAt) < 0
    || !Array.isArray(value.attachments)
    || value.attachments.length === 0
    || value.attachments.length > 20
  ) return undefined;
  const attachments: StoredImage[] = [];
  const blobIds = new Set<string>();
  let bytes = 0;
  for (const candidate of value.attachments) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["blobId", "name", "mimeType", "byteLength", "kind", "sha256"])) return undefined;
    if (
      !isOpaqueId(candidate.blobId)
      || blobIds.has(candidate.blobId)
      || typeof candidate.name !== "string"
      || candidate.name.length === 0
      || candidate.name.length > 1_024
      || basename(candidate.name) !== candidate.name
      || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(String(candidate.mimeType))
      || !Number.isSafeInteger(candidate.byteLength)
      || Number(candidate.byteLength) < 0
      || candidate.kind !== "image"
      || typeof candidate.sha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(candidate.sha256)
    ) return undefined;
    bytes += Number(candidate.byteLength);
    if (bytes > MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM) return undefined;
    blobIds.add(candidate.blobId);
    attachments.push({
      blobId: candidate.blobId,
      name: candidate.name,
      mimeType: candidate.mimeType as StoredImage["mimeType"],
      byteLength: Number(candidate.byteLength),
      kind: "image",
      sha256: candidate.sha256
    });
  }
  return {
    version: 1,
    workspaceId: value.workspaceId,
    taskId: value.taskId,
    itemId: value.itemId,
    createdAt: Number(value.createdAt),
    attachments
  };
}

async function readBoundedRegularFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) throw new Error("Prompt Stash image file exceeds its boundary.");
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) throw new Error("Prompt Stash image file exceeds its boundary.");
    return bytes;
  } finally {
    await handle.close();
  }
}

function publicImage(image: StoredImage): PromptStashImageRef {
  return {
    blobId: image.blobId,
    name: image.name,
    mimeType: image.mimeType,
    byteLength: image.byteLength,
    kind: "image"
  };
}

function manifestBytes(manifest: StoredItemManifest): number {
  return manifest.attachments.reduce((total, item) => total + item.byteLength, 0);
}

function isCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

function assertOpaqueId(value: unknown, field: string): string {
  if (!isOpaqueId(value)) throw new Error(`Prompt Stash image ${field} identity is invalid.`);
  return value;
}

async function ensureRealDirectory(parent: string, name: string): Promise<string> {
  const requested = join(parent, name);
  try {
    const metadata = await lstat(requested);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Prompt Stash image storage path is invalid.");
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
    await mkdir(requested, { mode: 0o700 });
  }
  return realpathNative(requested);
}

function assertContained(root: string, candidate: string): void {
  const fromRoot = relative(normalizePath(root), normalizePath(candidate));
  if (fromRoot !== "" && (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))) {
    throw new Error("Prompt Stash image storage escaped the Electron userData directory.");
  }
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
