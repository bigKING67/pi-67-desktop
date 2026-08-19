import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  defaultPackageNetworkSettings,
  npmRegistryCandidates,
  parsePackageNetworkSettings,
  type PackageNetworkSettings
} from "@pi67/domain";

const MAX_NETWORK_SETTINGS_BYTES = 32 * 1_024;
const DEFAULT_SOURCE_PROBE_TIMEOUT_MS = 8_000;

export class NpmRegistryUnavailableError extends Error {
  constructor(
    readonly mode: PackageNetworkSettings["npmMode"],
    readonly candidateCount: number,
    readonly reachableCandidateCount = 0,
    options?: ErrorOptions
  ) {
    super(
      candidateCount === 0
        ? "No npm package source is enabled."
        : reachableCandidateCount === 0
          ? "No reachable npm package source is available."
          : "No reachable npm package source completed the requested operation.",
      options
    );
    this.name = "NpmRegistryUnavailableError";
  }
}

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

export async function selectReachableNpmRegistry(
  settings: PackageNetworkSettings,
  options: {
    timeoutMs?: number;
    resourcePath?: string;
    probe?: (url: string, timeoutMs: number, resourcePath: string) => Promise<boolean>;
  } = {}
): Promise<string> {
  const result = await runWithNpmRegistryFallback(
    settings,
    async (registry) => registry,
    options
  );
  return result.value;
}

export async function runWithNpmRegistryFallback<T>(
  settings: PackageNetworkSettings,
  operation: (registry: string) => Promise<T>,
  options: {
    timeoutMs?: number;
    resourcePath?: string;
    probe?: (url: string, timeoutMs: number, resourcePath: string) => Promise<boolean>;
  } = {}
): Promise<{ registry: string; value: T }> {
  const candidates = npmRegistryCandidates(settings);
  const timeoutMs = options.timeoutMs ?? DEFAULT_SOURCE_PROBE_TIMEOUT_MS;
  const resourcePath = options.resourcePath ?? "/-/ping";
  if (!resourcePath.startsWith("/") || resourcePath.includes("\0")) {
    throw new Error("npm registry probe path is invalid.");
  }
  const probe = options.probe ?? probeNpmRegistry;
  let reachableCandidateCount = 0;
  let lastOperationError: unknown;
  for (const candidate of candidates) {
    try {
      if (!await probe(candidate.url, timeoutMs, resourcePath)) continue;
    } catch {
      // Continue through the configured source order without exposing transport details.
      continue;
    }
    reachableCandidateCount += 1;
    try {
      return { registry: candidate.url, value: await operation(candidate.url) };
    } catch (error) {
      lastOperationError = error;
    }
  }
  throw new NpmRegistryUnavailableError(
    settings.npmMode,
    candidates.length,
    reachableCandidateCount,
    lastOperationError === undefined ? undefined : { cause: lastOperationError }
  );
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

async function probeNpmRegistry(url: string, timeoutMs: number, resourcePath: string): Promise<boolean> {
  const response = await fetch(`${url}${resourcePath}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" }
  });
  return response.ok;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
