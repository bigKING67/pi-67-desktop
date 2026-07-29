import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  defaultPackageNetworkSettings,
  parsePackageNetworkSettings,
  type PackageNetworkSettings
} from "@pi67/protocol";

const realpathNative = promisify(realpath.native);

export const PACKAGE_NETWORK_DIRECTORY = "package-manager";
export const PACKAGE_NETWORK_FILENAME = "network-settings.json";
const MAX_PACKAGE_NETWORK_SETTINGS_BYTES = 32 * 1_024;

interface PersistedPackageNetworkSettings {
  schema: "pi67.package-network.v1";
  settings: PackageNetworkSettings;
}

export interface PackageNetworkSettingsStoreOptions {
  createToken?: () => string;
}

export class PackageNetworkSettingsStore {
  readonly requestedSettingsPath: string;
  readonly #requestedUserData: string;
  readonly #createToken: () => string;
  #pending: Promise<void> = Promise.resolve();

  constructor(userData: string, options: PackageNetworkSettingsStoreOptions = {}) {
    if (typeof userData !== "string" || userData.length === 0 || userData.includes("\0")) {
      throw new Error("Electron userData path is invalid.");
    }
    this.#requestedUserData = resolve(userData);
    this.requestedSettingsPath = join(
      this.#requestedUserData,
      PACKAGE_NETWORK_DIRECTORY,
      PACKAGE_NETWORK_FILENAME
    );
    this.#createToken = options.createToken ?? randomUUID;
  }

  load(): Promise<PackageNetworkSettings> {
    return this.#enqueue(() => this.#loadUnlocked());
  }

  save(value: unknown): Promise<PackageNetworkSettings> {
    return this.#enqueue(async () => {
      const settings = parsePackageNetworkSettings(value);
      if (!settings) throw new Error("Package network settings are invalid.");
      await this.#writeUnlocked(settings);
      return structuredClone(settings);
    });
  }

  reset(): Promise<PackageNetworkSettings> {
    return this.#enqueue(async () => {
      const settings = defaultPackageNetworkSettings();
      await this.#writeUnlocked(settings);
      return structuredClone(settings);
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #loadUnlocked(): Promise<PackageNetworkSettings> {
    const directory = await this.#ensureStorageDirectory();
    const path = join(directory, PACKAGE_NETWORK_FILENAME);
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return defaultPackageNetworkSettings();
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_PACKAGE_NETWORK_SETTINGS_BYTES) {
      throw new Error("Package network settings must be a bounded regular file.");
    }
    const handle = await open(path, "r");
    let serialized: string;
    try {
      const current = await handle.stat();
      if (current.size > MAX_PACKAGE_NETWORK_SETTINGS_BYTES) {
        throw new Error("Package network settings exceed the persistence size limit.");
      }
      serialized = await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_PACKAGE_NETWORK_SETTINGS_BYTES) {
      throw new Error("Package network settings exceed the persistence size limit.");
    }
    const persisted = parsePersistedSettings(serialized);
    if (!persisted) throw new Error("Package network settings are malformed.");
    if (process.platform !== "win32") await chmod(path, 0o600);
    return structuredClone(persisted.settings);
  }

  async #writeUnlocked(settings: PackageNetworkSettings): Promise<void> {
    const persisted: PersistedPackageNetworkSettings = {
      schema: "pi67.package-network.v1",
      settings
    };
    const serialized = `${JSON.stringify(persisted)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_PACKAGE_NETWORK_SETTINGS_BYTES) {
      throw new Error("Package network settings exceed the persistence size limit.");
    }
    const directory = await this.#ensureStorageDirectory();
    const path = join(directory, PACKAGE_NETWORK_FILENAME);
    const temporaryPath = join(
      directory,
      `.${PACKAGE_NETWORK_FILENAME}.${process.pid}.${this.#createToken()}.tmp`
    );
    let temporaryExists = false;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      temporaryExists = true;
      try {
        await handle.writeFile(serialized, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, path);
      temporaryExists = false;
      if (process.platform !== "win32") await chmod(path, 0o600);
    } finally {
      if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async #ensureStorageDirectory(): Promise<string> {
    await mkdir(this.#requestedUserData, { recursive: true, mode: 0o700 });
    const canonicalUserData = await realpathNative(this.#requestedUserData);
    const requestedDirectory = join(canonicalUserData, PACKAGE_NETWORK_DIRECTORY);
    try {
      const metadata = await lstat(requestedDirectory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error("Package network storage path must be a real directory.");
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      await mkdir(requestedDirectory, { mode: 0o700 });
    }
    const canonicalDirectory = await realpathNative(requestedDirectory);
    if (!isContained(canonicalDirectory, canonicalUserData)) {
      throw new Error("Package network storage escaped Electron userData.");
    }
    if (process.platform !== "win32") await chmod(canonicalDirectory, 0o700);
    return canonicalDirectory;
  }
}

export function parsePersistedPackageNetworkSettings(value: string): PackageNetworkSettings | undefined {
  return parsePersistedSettings(value)?.settings;
}

function parsePersistedSettings(serialized: string): PersistedPackageNetworkSettings | undefined {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "schema" && key !== "settings")) {
    return undefined;
  }
  if (value.schema !== "pi67.package-network.v1") return undefined;
  const settings = parsePackageNetworkSettings(value.settings);
  return settings ? { schema: value.schema, settings } : undefined;
}

function isContained(candidate: string, root: string): boolean {
  const fromRoot = relative(normalizePath(root), normalizePath(candidate));
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
