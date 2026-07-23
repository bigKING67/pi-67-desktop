import { gt, rcompare, valid } from "semver";

const UNSIGNED_PREVIEW_CHANNEL = "unsigned-preview" as const;
export const RELEASES_API_URL = "https://api.github.com/repos/bigKING67/pi-67-desktop/releases?per_page=20";
export const MAX_RELEASE_RESPONSE_BYTES = 1_048_576;

const releasePageBaseUrl = "https://github.com/bigKING67/pi-67-desktop/releases/tag/";
const requestTimeoutMilliseconds = 10_000;
const maximumReleases = 20;

export type ManualUpdateState =
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
      releaseUrl: string;
      publishedAt?: string;
    }
  | {
      phase: "disabled" | "error";
      channel: typeof UNSIGNED_PREVIEW_CHANNEL;
      currentVersion: string;
      detail: string;
    };

interface ReleaseCandidate {
  version: string;
  publishedAt?: string;
}

interface CheckForUnsignedPreviewUpdateOptions {
  currentVersion: string;
  fetcher: (input: string, init: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
}

export async function checkForUnsignedPreviewUpdate(
  options: CheckForUnsignedPreviewUpdateOptions
): Promise<ManualUpdateState> {
  const currentVersion = valid(options.currentVersion);
  if (!currentVersion) throw new Error("The current application version is not valid SemVer.");

  const response = await options.fetcher(RELEASES_API_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": `Pi-67-Desktop/${currentVersion}`
    },
    signal: options.signal ?? AbortSignal.timeout(requestTimeoutMilliseconds)
  });
  if (!response.ok) throw new Error(`GitHub Releases request failed with HTTP ${response.status}.`);

  const releases = parseReleaseResponse(await readBoundedResponseText(response));
  const latest = selectLatestUnsignedPreview(releases);
  if (!latest || !gt(latest.version, currentVersion)) {
    return {
      phase: "current",
      channel: UNSIGNED_PREVIEW_CHANNEL,
      currentVersion
    };
  }

  return {
    phase: "available",
    channel: UNSIGNED_PREVIEW_CHANNEL,
    currentVersion,
    version: latest.version,
    releaseUrl: releasePageUrl(latest.version),
    ...(latest.publishedAt ? { publishedAt: latest.publishedAt } : {})
  };
}

export function selectLatestUnsignedPreview(value: unknown): ReleaseCandidate | undefined {
  if (!Array.isArray(value)) throw new Error("GitHub Releases response must be an array.");
  const candidates = value.slice(0, maximumReleases).flatMap((release): ReleaseCandidate[] => {
    if (!isRecord(release) || release.draft !== false || release.prerelease !== true) return [];
    if (typeof release.tag_name !== "string" || !release.tag_name.startsWith("v")) return [];

    const version = valid(release.tag_name.slice(1));
    if (!version || release.tag_name !== `v${version}` || !hasExpectedAssets(release.assets, version)) return [];
    const publishedAt = parsePublishedAt(release.published_at);
    return [{ version, ...(publishedAt ? { publishedAt } : {}) }];
  });
  return candidates.sort((left, right) => rcompare(left.version, right.version))[0];
}

export function releasePageUrl(version: string): string {
  const normalizedVersion = valid(version);
  if (!normalizedVersion || normalizedVersion !== version) throw new Error("Release version is not valid SemVer.");
  return `${releasePageBaseUrl}v${normalizedVersion}`;
}

export async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_RELEASE_RESPONSE_BYTES) {
      throw new Error("GitHub Releases response exceeded the 1 MiB limit.");
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
      if (bytesRead > MAX_RELEASE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("GitHub Releases response exceeded the 1 MiB limit.");
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseReleaseResponse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("GitHub Releases returned invalid JSON.");
  }
}

function hasExpectedAssets(value: unknown, version: string): boolean {
  if (!Array.isArray(value)) return false;
  const names = new Set(value.flatMap((asset): string[] => {
    if (!isRecord(asset) || typeof asset.name !== "string") return [];
    return [asset.name];
  }));
  return expectedAssetNames(version).every((name) => names.has(name));
}

function expectedAssetNames(version: string): string[] {
  return [
    `Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`,
    `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.dmg`,
    `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`,
    "SHA256SUMS.txt",
    "unsigned-preview-manifest.json"
  ];
}

function parsePublishedAt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
