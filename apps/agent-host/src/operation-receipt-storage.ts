import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import {
  assertConsistentOperationTerminals,
  cloneOperationReceiptLedger,
  emptyOperationReceiptLedger,
  isOperationReceiptLedger,
  operationReceiptIntegrityError,
  type OperationReceiptLedger
} from "./operation-receipt-contract.js";
import { HostCommandError } from "./protocol-error.js";

const RECEIPT_DIRECTORY = "operation-receipts-v1";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;

export function operationReceiptLedgerPath(
  storageRoot: string | undefined,
  scopeKey: string
): string | undefined {
  if (storageRoot === undefined) return undefined;
  if (storageRoot.length === 0 || storageRoot.includes("\0")) {
    throw new TypeError("Operation receipt storageRoot is invalid.");
  }
  return join(resolve(storageRoot), RECEIPT_DIRECTORY, `${scopeKey}.json`);
}

export async function withStoredOperationReceiptLedger<T>(
  path: string,
  scopeKey: string,
  write: boolean,
  operation: (ledger: OperationReceiptLedger) => T
): Promise<T> {
  try {
    await ensurePrivateDirectory(dirname(path));
    const release = await lockfile.lock(path, {
      realpath: false,
      retries: { retries: 8, factor: 1.5, minTimeout: 25, maxTimeout: 250 },
      stale: 10_000
    });
    try {
      const ledger = await readLedger(path, scopeKey);
      const result = operation(ledger);
      if (write) await writeLedger(path, ledger);
      return result;
    } finally {
      await release();
    }
  } catch (error) {
    if (error instanceof HostCommandError) throw error;
    throw operationReceiptIntegrityError("The durable Operation receipt ledger is unavailable.");
  }
}

async function readLedger(path: string, scopeKey: string): Promise<OperationReceiptLedger> {
  const info = await lstat(path).catch((error: unknown) => (
    nodeErrorCode(error) === "ENOENT" ? undefined : Promise.reject(error)
  ));
  if (!info) return emptyOperationReceiptLedger(scopeKey);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > MAX_LEDGER_BYTES) {
    throw operationReceiptIntegrityError("The durable Operation receipt ledger has unsafe filesystem metadata.");
  }
  const parsed = await readFile(path, "utf8")
    .then((content) => JSON.parse(content) as unknown)
    .catch(() => {
      throw operationReceiptIntegrityError("The durable Operation receipt ledger cannot be parsed.");
    });
  if (!isOperationReceiptLedger(parsed, scopeKey)) {
    throw operationReceiptIntegrityError("The durable Operation receipt ledger failed validation.");
  }
  assertConsistentOperationTerminals(parsed.records);
  return cloneOperationReceiptLedger(parsed);
}

async function writeLedger(path: string, ledger: OperationReceiptLedger): Promise<void> {
  if (!isOperationReceiptLedger(ledger, ledger.scopeKey)) {
    throw operationReceiptIntegrityError("The durable Operation receipt ledger is invalid.");
  }
  const serialized = `${JSON.stringify(ledger)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_LEDGER_BYTES) {
    throw operationReceiptIntegrityError("The durable Operation receipt ledger exceeds its storage limit.");
  }
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${randomUUID()}.pi67-operation-tmp`);
  const file = await open(temporaryPath, "wx", PRIVATE_FILE_MODE);
  try {
    await file.writeFile(serialized, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    if (process.platform !== "win32") await chmod(temporaryPath, PRIVATE_FILE_MODE);
    await replaceWithBoundedRetry(temporaryPath, path);
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw operationReceiptIntegrityError("The durable Operation receipt directory is not a real directory.");
  }
  if (process.platform !== "win32") await chmod(directory, PRIVATE_DIRECTORY_MODE);
}

async function replaceWithBoundedRetry(source: string, target: string): Promise<void> {
  const delays = [25, 50, 100, 200];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!isRetryableReplaceError(error) || attempt >= delays.length) throw error;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delays[attempt]));
    }
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

function isRetryableReplaceError(error: unknown): boolean {
  const code = nodeErrorCode(error);
  return code === "EACCES" || code === "EPERM" || code === "EBUSY";
}

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}
