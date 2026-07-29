export type NpmSourceMode = "automatic" | "mirror-only" | "official-only" | "custom" | "offline";
export type GitSourceMode = "automatic" | "mirror-only" | "official-only" | "offline";
export type BuiltInGitMirrorId = "gitclone" | "ghproxy";

export interface PackageNetworkSettings {
  npmMode: NpmSourceMode;
  npmCustomRegistry?: string;
  gitMode: GitSourceMode;
  gitMirrors: readonly BuiltInGitMirrorId[];
  gitCustomMirrorPrefix?: string;
}

export interface PackageSourceHealth {
  id: string;
  kind: "npm" | "git";
  role: "public-mirror" | "official" | "custom";
  url: string;
  status: "reachable" | "unreachable" | "not-checked";
  latencyMs?: number;
  resolvedRevision?: string;
  detail?: string;
}

export interface DesktopToolchainStatus {
  ready: boolean;
  packaged: boolean;
  platform: "darwin" | "win32";
  architecture: "arm64" | "x64";
  nodeVersion?: string;
  npmVersion?: string;
  gitVersion?: string;
  detail?: string;
}

export interface PackageNetworkSnapshot {
  settings: PackageNetworkSettings;
  toolchain: DesktopToolchainStatus;
  sources: PackageSourceHealth[];
  checkedAt?: number;
}

export const DEFAULT_PACKAGE_NETWORK_SETTINGS: Readonly<PackageNetworkSettings> = Object.freeze({
  npmMode: "automatic",
  gitMode: "automatic",
  gitMirrors: Object.freeze(["gitclone", "ghproxy"] as BuiltInGitMirrorId[])
});

export const PUBLIC_NPM_REGISTRY = "https://registry.npmmirror.com";
export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";
export const GIT_PROBE_REPOSITORY = "https://github.com/arpagon/pi-rewind.git";

const MAX_SOURCE_URL_LENGTH = 2_048;

export function defaultPackageNetworkSettings(): PackageNetworkSettings {
  return {
    npmMode: DEFAULT_PACKAGE_NETWORK_SETTINGS.npmMode,
    gitMode: DEFAULT_PACKAGE_NETWORK_SETTINGS.gitMode,
    gitMirrors: [...DEFAULT_PACKAGE_NETWORK_SETTINGS.gitMirrors]
  };
}

export function parsePackageNetworkSettings(value: unknown): PackageNetworkSettings | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = new Set([
    "npmMode",
    "npmCustomRegistry",
    "gitMode",
    "gitMirrors",
    "gitCustomMirrorPrefix"
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined;
  if (!isNpmSourceMode(value.npmMode) || !isGitSourceMode(value.gitMode)) return undefined;
  if (!Array.isArray(value.gitMirrors) || value.gitMirrors.length > 2) return undefined;
  if (!value.gitMirrors.every(isBuiltInGitMirrorId) || new Set(value.gitMirrors).size !== value.gitMirrors.length) {
    return undefined;
  }
  const npmCustomRegistry = optionalPublicHttpsUrl(value.npmCustomRegistry);
  if (value.npmCustomRegistry !== undefined && npmCustomRegistry === undefined) return undefined;
  const gitCustomMirrorPrefix = optionalPublicHttpsUrl(value.gitCustomMirrorPrefix);
  if (value.gitCustomMirrorPrefix !== undefined && gitCustomMirrorPrefix === undefined) return undefined;
  if (value.npmMode === "custom" && npmCustomRegistry === undefined) return undefined;
  return {
    npmMode: value.npmMode,
    ...(npmCustomRegistry === undefined ? {} : { npmCustomRegistry }),
    gitMode: value.gitMode,
    gitMirrors: [...value.gitMirrors],
    ...(gitCustomMirrorPrefix === undefined ? {} : { gitCustomMirrorPrefix })
  };
}

export function npmRegistryCandidates(settings: PackageNetworkSettings): Array<{
  id: string;
  role: PackageSourceHealth["role"];
  url: string;
}> {
  if (settings.npmMode === "offline") return [];
  if (settings.npmMode === "custom") {
    return settings.npmCustomRegistry
      ? [{ id: "npm-custom", role: "custom", url: trimTrailingSlash(settings.npmCustomRegistry) }]
      : [];
  }
  if (settings.npmMode === "mirror-only") {
    return [{ id: "npm-public-mirror", role: "public-mirror", url: PUBLIC_NPM_REGISTRY }];
  }
  if (settings.npmMode === "official-only") {
    return [{ id: "npm-official", role: "official", url: OFFICIAL_NPM_REGISTRY }];
  }
  return [
    ...(settings.npmCustomRegistry
      ? [{ id: "npm-custom", role: "custom" as const, url: trimTrailingSlash(settings.npmCustomRegistry) }]
      : []),
    { id: "npm-public-mirror", role: "public-mirror", url: PUBLIC_NPM_REGISTRY },
    { id: "npm-official", role: "official", url: OFFICIAL_NPM_REGISTRY }
  ];
}

export function gitSourceCandidates(
  settings: PackageNetworkSettings,
  canonicalUrl = GIT_PROBE_REPOSITORY
): Array<{
  id: string;
  role: PackageSourceHealth["role"];
  transportUrl: string;
  insteadOfPrefix?: string;
}> {
  if (settings.gitMode === "offline") return [];
  const mirrors = settings.gitMode === "official-only"
    ? []
    : settings.gitMirrors.flatMap((id) => builtInGitMirror(id, canonicalUrl));
  const custom = settings.gitMode === "official-only" || !settings.gitCustomMirrorPrefix
    ? []
    : [{
        id: "git-custom",
        role: "custom" as const,
        transportUrl: `${trimTrailingSlash(settings.gitCustomMirrorPrefix)}/${canonicalUrl}`,
        insteadOfPrefix: `${trimTrailingSlash(settings.gitCustomMirrorPrefix)}/https://github.com/`
      }];
  const official = settings.gitMode === "mirror-only"
    ? []
    : [{ id: "git-official", role: "official" as const, transportUrl: canonicalUrl }];
  return [...custom, ...mirrors, ...official];
}

function builtInGitMirror(id: BuiltInGitMirrorId, canonicalUrl: string) {
  if (id === "gitclone") {
    const githubPath = githubRepositoryPath(canonicalUrl);
    return githubPath
      ? [{
          id: "git-gitclone",
          role: "public-mirror" as const,
          transportUrl: `https://gitclone.com/github.com/${githubPath}`,
          insteadOfPrefix: "https://gitclone.com/github.com/"
        }]
      : [];
  }
  return [{
    id: "git-ghproxy",
    role: "public-mirror" as const,
    transportUrl: `https://ghproxy.net/${canonicalUrl}`,
    insteadOfPrefix: "https://ghproxy.net/https://github.com/"
  }];
}

function githubRepositoryPath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "github.com") return undefined;
    const path = parsed.pathname.replace(/^\/+|\/+$/gu, "");
    return path.split("/").length >= 2 ? path : undefined;
  } catch {
    return undefined;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/gu, "");
}

function optionalPublicHttpsUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SOURCE_URL_LENGTH) return undefined;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.hash.length > 0
      || parsed.search.length > 0
    ) return undefined;
    return trimTrailingSlash(parsed.toString());
  } catch {
    return undefined;
  }
}

function isNpmSourceMode(value: unknown): value is NpmSourceMode {
  return value === "automatic"
    || value === "mirror-only"
    || value === "official-only"
    || value === "custom"
    || value === "offline";
}

function isGitSourceMode(value: unknown): value is GitSourceMode {
  return value === "automatic"
    || value === "mirror-only"
    || value === "official-only"
    || value === "offline";
}

function isBuiltInGitMirrorId(value: unknown): value is BuiltInGitMirrorId {
  return value === "gitclone" || value === "ghproxy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
