import { gt, valid } from "semver";

export const UNSIGNED_PREVIEW_CHANNEL = "unsigned-preview" as const;
const UPDATE_ORIGIN = "https://updates.52671314.xyz";
export const UPDATE_MANIFEST_URL = `${UPDATE_ORIGIN}/unsigned-preview-manifest.json`;
export const MAX_UPDATE_MANIFEST_BYTES = 1_048_576;
const MAX_UPDATE_ARTIFACT_BYTES = 2 * 1_024 * 1_024 * 1_024;

const productName = "Pi-67 Desktop";
const requestTimeoutMilliseconds = 10_000;

export type SupportedUpdatePlatform = "darwin" | "win32";

export interface TrustedUpdateArtifact {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly target: "macos-arm64" | "windows-x64";
  readonly url: string;
}

type UnsignedPreviewUpdateResult =
  | {
      phase: "idle" | "current";
      channel: typeof UNSIGNED_PREVIEW_CHANNEL;
      currentVersion: string;
    }
  | {
      phase: "available";
      channel: typeof UNSIGNED_PREVIEW_CHANNEL;
      currentVersion: string;
      version: string;
      artifactName: string;
      artifactBytes: number;
    }
  | {
      phase: "disabled" | "error";
      channel: typeof UNSIGNED_PREVIEW_CHANNEL;
      currentVersion: string;
      detail: string;
    };

export interface CheckedUnsignedPreviewUpdate {
  readonly state: UnsignedPreviewUpdateResult;
  readonly artifact?: TrustedUpdateArtifact;
}

interface CheckForUnsignedPreviewUpdateOptions {
  currentVersion: string;
  platform: SupportedUpdatePlatform;
  fetcher: (input: string, init: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
}

export async function checkForUnsignedPreviewUpdate(
  options: CheckForUnsignedPreviewUpdateOptions
): Promise<CheckedUnsignedPreviewUpdate> {
  const currentVersion = valid(options.currentVersion);
  if (!currentVersion) throw new Error("The current application version is not valid SemVer.");

  const response = await options.fetcher(UPDATE_MANIFEST_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": `Pi-67-Desktop/${currentVersion}`
    },
    redirect: "error",
    signal: options.signal ?? AbortSignal.timeout(requestTimeoutMilliseconds)
  });
  if (!response.ok) throw new Error(`Pi-67 update manifest request failed with HTTP ${response.status}.`);
  assertFixedResponseUrl(response.url, UPDATE_MANIFEST_URL, "manifest");

  const manifest = parseUnsignedPreviewManifest(
    JSON.parse(await readBoundedResponseText(response)) as unknown
  );
  if (!gt(manifest.version, currentVersion)) {
    return {
      state: {
        phase: "current",
        channel: UNSIGNED_PREVIEW_CHANNEL,
        currentVersion
      }
    };
  }

  const artifact = selectPlatformArtifact(manifest, options.platform);
  return {
    state: {
      phase: "available",
      channel: UNSIGNED_PREVIEW_CHANNEL,
      currentVersion,
      version: manifest.version,
      artifactName: artifact.name,
      artifactBytes: artifact.bytes
    },
    artifact
  };
}

export function parseUnsignedPreviewManifest(value: unknown): {
  readonly version: string;
  readonly artifacts: readonly TrustedUpdateArtifact[];
} {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion",
    "product",
    "version",
    "channel",
    "signed",
    "runtime",
    "files"
  ])) {
    throw new Error("Pi-67 update manifest has an invalid shape.");
  }
  const version = typeof value.version === "string" ? valid(value.version) : null;
  if (
    value.schemaVersion !== 1
    || value.product !== productName
    || value.channel !== UNSIGNED_PREVIEW_CHANNEL
    || value.signed !== false
    || !version
    || value.version !== version
    || typeof value.runtime !== "string"
    || value.runtime.length < 1
    || value.runtime.length > 200
    || !Array.isArray(value.files)
    || value.files.length !== 3
  ) {
    throw new Error("Pi-67 update manifest identity is invalid.");
  }

  const expected = expectedArtifactTargets(version);
  const names = new Set<string>();
  const artifacts = value.files.map((entry): TrustedUpdateArtifact => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["name", "bytes", "sha256", "target"])) {
      throw new Error("Pi-67 update manifest contains an invalid artifact entry.");
    }
    if (typeof entry.name !== "string" || names.has(entry.name)) {
      throw new Error("Pi-67 update manifest contains a duplicate or invalid artifact name.");
    }
    names.add(entry.name);
    const target = expected.get(entry.name);
    if (
      target === undefined
      || entry.target !== target
      || !Number.isSafeInteger(entry.bytes)
      || (entry.bytes as number) < 1
      || (entry.bytes as number) > MAX_UPDATE_ARTIFACT_BYTES
      || typeof entry.sha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error(`Pi-67 update artifact ${entry.name} is invalid.`);
    }
    const url = new URL(entry.name, `${UPDATE_ORIGIN}/`).toString();
    assertFixedResponseUrl(url, `${UPDATE_ORIGIN}/${entry.name}`, "artifact");
    return {
      name: entry.name,
      bytes: entry.bytes as number,
      sha256: entry.sha256,
      target,
      url
    };
  });
  if ([...expected.keys()].some((name) => !names.has(name))) {
    throw new Error("Pi-67 update manifest is incomplete.");
  }
  return { version, artifacts };
}

export async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_UPDATE_MANIFEST_BYTES) {
      throw new Error("Pi-67 update manifest exceeded the 1 MiB limit.");
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_UPDATE_MANIFEST_BYTES) {
        await reader.cancel();
        throw new Error("Pi-67 update manifest exceeded the 1 MiB limit.");
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function selectPlatformArtifact(
  manifest: ReturnType<typeof parseUnsignedPreviewManifest>,
  platform: SupportedUpdatePlatform
): TrustedUpdateArtifact {
  const suffix = platform === "win32"
    ? "-win-x64-unsigned-preview.exe"
    : "-mac-arm64-unsigned-preview.zip";
  const artifact = manifest.artifacts.find((entry) => entry.name.endsWith(suffix));
  if (!artifact) throw new Error(`Pi-67 update manifest has no artifact for ${platform}.`);
  return artifact;
}

function expectedArtifactTargets(version: string): Map<string, TrustedUpdateArtifact["target"]> {
  return new Map([
    [`Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`, "windows-x64"],
    [`Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.dmg`, "macos-arm64"],
    [`Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`, "macos-arm64"]
  ]);
}

function assertFixedResponseUrl(actual: string, expected: string, label: string): void {
  if (actual.length === 0) return;
  const normalized = new URL(actual);
  if (
    normalized.protocol !== "https:"
    || normalized.origin !== UPDATE_ORIGIN
    || normalized.username !== ""
    || normalized.password !== ""
    || normalized.search !== ""
    || normalized.hash !== ""
    || normalized.toString() !== expected
  ) {
    throw new Error(`Pi-67 update ${label} redirected outside its fixed URL.`);
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  return keys.length === required.length && keys.every((key, index) => key === required[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
