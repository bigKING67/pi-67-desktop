import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Read only fixed metadata files. Trust never comes from this installation. */
export async function loadOpenVikingRuntimeInstallation(installationRoot: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!isAbsolute(installationRoot) || installationRoot.includes("\0")) throw new Error("Invalid runtime installation path.");
  const runtimeRoot = join(installationRoot, "runtime");
  for (const path of [installationRoot, runtimeRoot]) {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || (process.platform !== "win32" && (metadata.mode & 0o022) !== 0)) {
      throw new Error("Unsafe runtime installation directory.");
    }
  }
  const manifest = await readMetadata(join(installationRoot, "manifest.json"), 8_192, signal);
  const signature = await readMetadata(join(installationRoot, "manifest.sig"), 64, signal);
  if (!manifest.length || signature.length !== 64) throw new Error("Invalid runtime installation metadata.");
  signal.throwIfAborted();
  return { runtimeRoot, manifest, signature };
}

async function readMetadata(path: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > limit) throw new Error("Invalid runtime metadata file.");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (before.ino !== metadata.ino || before.dev !== metadata.dev || before.size > limit) throw new Error("Runtime metadata changed during read.");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      signal.throwIfAborted();
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(path);
    if (length > limit || length !== before.size || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || current.dev !== before.dev || current.ino !== before.ino || current.isSymbolicLink()) {
      throw new Error("Runtime metadata changed during read.");
    }
    signal.throwIfAborted();
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
