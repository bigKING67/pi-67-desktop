import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";

const PRIVATE_FILE_MODE = 0o600;

export async function withConfigurationFileLock<T>(
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const release = await lockfile.lock(path, {
    realpath: false,
    retries: { retries: 8, factor: 1.5, minTimeout: 25, maxTimeout: 250 },
    stale: 10_000
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function writePrivateFileAtomically(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const existingMode = await stat(path).then((value) => value.mode & 0o777, () => undefined);
  const temporaryPath = join(directory, `.${randomUUID()}.pi67-tmp`);
  const file = await open(temporaryPath, "wx", existingMode ?? PRIVATE_FILE_MODE);
  try {
    await file.writeFile(content, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    if (existingMode !== undefined) await chmod(temporaryPath, existingMode);
    await rename(temporaryPath, path);
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r").catch(() => undefined);
  if (!handle) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
}
