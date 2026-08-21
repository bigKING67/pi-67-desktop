import { createHash, randomUUID } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TrustedUpdateArtifact } from "./unsigned-preview-update.js";
import { ensureUnsignedUpdateDirectory } from "./unsigned-update-directory.js";

export interface UnsignedUpdateDownloadProgress {
  readonly transferred: number;
  readonly total: number;
  readonly percent: number;
}

interface DownloadUnsignedUpdateOptions {
  artifact: TrustedUpdateArtifact;
  directory: string;
  fetcher: (input: string, init: RequestInit) => Promise<Response>;
  signal: AbortSignal;
  onProgress: (progress: UnsignedUpdateDownloadProgress) => void;
}

export interface VerifiedUnsignedUpdateDownload {
  readonly path: string;
  readonly artifact: TrustedUpdateArtifact;
}

export async function downloadUnsignedUpdate(
  options: DownloadUnsignedUpdateOptions
): Promise<VerifiedUnsignedUpdateDownload> {
  await ensureUnsignedUpdateDirectory(options.directory);
  const finalPath = join(options.directory, `pending-${options.artifact.name}`);
  const temporaryPath = join(options.directory, `.download-${randomUUID()}.part`);
  await removeTaskOwnedFile(finalPath);

  const response = await options.fetcher(options.artifact.url, {
    method: "GET",
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "Pi-67-Desktop-Internal-Updater"
    },
    redirect: "error",
    signal: options.signal
  });
  if (!response.ok || response.status !== 200) {
    throw new Error(`Pi-67 update download failed with HTTP ${response.status}.`);
  }
  if (response.url.length > 0 && response.url !== options.artifact.url) {
    throw new Error("Pi-67 update download redirected away from the verified artifact URL.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== options.artifact.bytes) {
    throw new Error("Pi-67 update download size does not match the manifest.");
  }
  if (!response.body) throw new Error("Pi-67 update download returned an empty body.");

  const file = await open(temporaryPath, "wx", 0o600);
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let transferred = 0;
  let lastPublishedAt = 0;
  try {
    while (true) {
      options.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      transferred += value.byteLength;
      if (transferred > options.artifact.bytes) {
        await reader.cancel();
        throw new Error("Pi-67 update download exceeded the manifest size.");
      }
      hash.update(value);
      await writeCompleteChunk(file, value);
      const now = Date.now();
      if (now - lastPublishedAt >= 200 || transferred === options.artifact.bytes) {
        lastPublishedAt = now;
        options.onProgress(progress(transferred, options.artifact.bytes));
      }
    }
    if (transferred !== options.artifact.bytes) {
      throw new Error("Pi-67 update download ended before the manifest size was reached.");
    }
    if (hash.digest("hex") !== options.artifact.sha256) {
      throw new Error("Pi-67 update download failed SHA-256 verification.");
    }
    await file.sync();
    await file.close();
    await rename(temporaryPath, finalPath);
    options.onProgress(progress(transferred, options.artifact.bytes));
    return { path: finalPath, artifact: options.artifact };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await file.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeCompleteChunk(
  file: Awaited<ReturnType<typeof open>>,
  value: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const { bytesWritten } = await file.write(value, offset, value.byteLength - offset, null);
    if (bytesWritten < 1) throw new Error("Pi-67 update download could not write its verified bytes.");
    offset += bytesWritten;
  }
}

function progress(transferred: number, total: number): UnsignedUpdateDownloadProgress {
  return {
    transferred,
    total,
    percent: Math.min(100, Math.max(0, (transferred / total) * 100))
  };
}

async function removeTaskOwnedFile(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("The Pi-67 pending update path is not a regular file.");
    }
    await rm(path, { force: true });
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
