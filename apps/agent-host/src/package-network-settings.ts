import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  defaultPackageNetworkSettings,
  parsePackageNetworkSettings,
  type PackageNetworkSettings
} from "@pi67/domain";

const MAX_NETWORK_SETTINGS_BYTES = 32 * 1_024;

export async function loadPackageNetworkSettings(path: string | undefined): Promise<PackageNetworkSettings> {
  if (!path) return defaultPackageNetworkSettings();
  if (!isAbsolute(path) || path.includes("\0")) {
    throw new Error("Package network settings are invalid.");
  }
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_NETWORK_SETTINGS_BYTES) {
      throw new Error("invalid settings file");
    }
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.schema !== "pi67.package-network.v1") {
      throw new Error("invalid settings schema");
    }
    const settings = parsePackageNetworkSettings(parsed.settings);
    if (!settings) throw new Error("invalid settings payload");
    return settings;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return defaultPackageNetworkSettings();
    throw new Error("Package network settings are invalid.", { cause: error });
  }
}

export function isolatedGitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("GIT_CONFIG_")) delete environment[key];
  }
  environment.GIT_CONFIG_COUNT = "0";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  return environment;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
