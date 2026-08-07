import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const WINDOWS_REPLACE_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;
const WINDOWS_TRANSIENT_REPLACE_ERRORS = new Set(["EACCES", "EPERM", "EBUSY"]);

interface SafeAtomicReplaceOptions {
  mode?: number;
  beforeCommit?: () => Promise<void>;
  validateTemporaryPath?: (path: string) => void;
  platform?: NodeJS.Platform;
  renameFile?: typeof rename;
  sleep?: (milliseconds: number) => Promise<void>;
  createToken?: () => string;
}

/** Flushes a same-directory temporary file before a bounded, atomic replacement. */
export async function safeAtomicReplaceFile(
  targetPath: string,
  content: string | Uint8Array,
  options: SafeAtomicReplaceOptions = {}
): Promise<void> {
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(targetPath)}.pi67-${process.pid}-${(options.createToken ?? randomUUID)()}.tmp`
  );
  options.validateTemporaryPath?.(temporaryPath);
  const mode = normalizeMode(options.mode);
  let temporaryExists = false;
  try {
    const file = await open(temporaryPath, "wx", mode);
    temporaryExists = true;
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    if ((options.platform ?? process.platform) !== "win32") await chmod(temporaryPath, mode);
    await renameWithWindowsRetry(temporaryPath, targetPath, options);
    temporaryExists = false;
    await syncDirectoryBestEffort(directory);
  } finally {
    if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
  }
}

async function renameWithWindowsRetry(
  sourcePath: string,
  targetPath: string,
  options: SafeAtomicReplaceOptions
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const renameFile = options.renameFile ?? rename;
  const sleep = options.sleep ?? delay;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await options.beforeCommit?.();
      await renameFile(sourcePath, targetPath);
      return;
    } catch (error) {
      const retryDelay = WINDOWS_REPLACE_RETRY_DELAYS_MS[attempt];
      if (
        platform !== "win32"
        || retryDelay === undefined
        || !isTransientWindowsReplaceError(error)
      ) throw error;
      await sleep(retryDelay);
    }
  }
}

function normalizeMode(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0
    ? value & 0o777
    : 0o600;
}

function isTransientWindowsReplaceError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && WINDOWS_TRANSIENT_REPLACE_ERRORS.has(error.code);
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  const handle = await open(directory, "r").catch(() => undefined);
  if (!handle) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
