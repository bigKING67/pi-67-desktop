import { nativeCapabilityReplacement, type NativeCapabilityReplacement } from "./native-capability-replacements.js";

/**
 * Extension marketplace model. Registry metadata is untrusted public text: every field is
 * bounded, control characters are removed, publisher email is never kept, and only
 * `https:` repository links survive normalization.
 */

/** npm `/-/v1/search` returns at most 250 objects per request. */
export const PACKAGE_MARKET_PAGE_SIZE = 250;
/** The browse index covers the most popular Packages; local sorts operate on it. */
export const PACKAGE_MARKET_BROWSE_LIMIT = 500;
export const PACKAGE_MARKET_SEARCH_LIMIT = 50;
export const PACKAGE_MARKET_QUERY_MAX_LENGTH = 100;
export const PACKAGE_MARKET_INDEX_FRESH_MS = 6 * 60 * 60 * 1_000;
export const PACKAGE_MARKET_STALE_AFTER_MS = 365 * 24 * 60 * 60 * 1_000;
export const PACKAGE_MARKET_DESCRIPTION_MAX_LENGTH = 280;
export const PACKAGE_MARKET_DETAIL_DESCRIPTION_MAX_LENGTH = 1_000;
export const PACKAGE_MARKET_URL_MAX_LENGTH = 512;
export const PACKAGE_MARKET_KEYWORD = "pi-package";

/** Retired third-party Context/Memory owners; OpenViking is the only supported owner. */
export const RETIRED_MEMORY_OWNER_IDS: ReadonlySet<string> = new Set([
  "pi-observational-memory",
  "pi-hy-memory"
]);

export type PackageMarketSort = "popular" | "updated" | "name" | "relevance";
export type PackageMarketResourceType = "extension" | "skill" | "prompt" | "theme";
export type PackageMarketUnavailableReason = "offline" | "mirror-only" | "network";

export interface PackageMarketEntry {
  name: string;
  version: string;
  description?: string;
  publishedAt?: string;
  monthlyDownloads: number;
  weeklyDownloads: number;
  publisher?: string;
  license?: string;
  repositoryUrl?: string;
}

export interface PackageMarketIndex {
  entries: PackageMarketEntry[];
  /** Ecosystem size reported by the registry, not the length of `entries`. */
  total: number;
  fetchedAt: string;
}

/** Browse result: a fresh or cached index, or the reason none is available. */
export type PackageMarketBrowseResult =
  | { status: "ready"; index: PackageMarketIndex; stale: boolean; notice?: PackageMarketUnavailableReason }
  | { status: "unavailable"; reason: PackageMarketUnavailableReason };

export type PackageMarketSearchResult =
  | { status: "ready"; query: string; entries: PackageMarketEntry[]; total: number }
  | { status: "unavailable"; query: string; reason: PackageMarketUnavailableReason };

export interface PackageMarketDetail {
  name: string;
  version: string;
  description?: string;
  license?: string;
  repositoryUrl?: string;
  /** Declared through the `pi` manifest; empty when the Package declares none. */
  resourceTypes: PackageMarketResourceType[];
}

export type PackageMarketDetailResult =
  | { status: "ready"; detail: PackageMarketDetail }
  | { status: "unavailable"; name: string; reason: PackageMarketUnavailableReason };

export type PackageMarketAvailability =
  | { kind: "installable" }
  | { kind: "installed" }
  | { kind: "native-replaced"; replacement: NativeCapabilityReplacement }
  | { kind: "memory-conflict" };

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const NPM_SOURCE = /^npm:((?:@[^/@\s]+\/)?[^@/\s]+)(?:@[^/\s]+)?$/u;
/** C0/C1 controls plus zero-width, bidi-override and BOM characters that can disguise text. */
function isUnsafeTextCodePoint(code: number): boolean {
  return code < 0x20
    || (code >= 0x7f && code <= 0x9f)
    || (code >= 0x200b && code <= 0x200f)
    || (code >= 0x202a && code <= 0x202e)
    || (code >= 0x2066 && code <= 0x2069)
    || code === 0xfeff;
}

export function isNpmPackageName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 214 && NPM_NAME.test(value);
}

/** Package name of an `npm:` source, ignoring a version or tag; undefined for other sources. */
export function npmSourcePackageName(source: string): string | undefined {
  return NPM_SOURCE.exec(source.trim())?.[1];
}

export function packageMarketInstallSource(name: string): string {
  return `npm:${name}`;
}

export function packageMarketNpmUrl(name: string): string {
  return `https://www.npmjs.com/package/${name}`;
}

export function boundedPackageMarketText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = Array.from(value, (character) => (
    isUnsafeTextCodePoint(character.codePointAt(0) ?? 0) ? " " : character
  )).join("").replace(/\s+/gu, " ").trim();
  if (text.length === 0) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Accepts `https:` URLs (also `git+https:` and `.git` forms) without credentials. */
export function packageMarketRepositoryUrl(value: unknown): string | undefined {
  const raw = typeof value === "string"
    ? value
    : isRecord(value) && typeof value.url === "string" ? value.url : undefined;
  if (!raw || raw.length > PACKAGE_MARKET_URL_MAX_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^git\+/u, ""));
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return undefined;
  url.hash = "";
  url.search = "";
  const normalized = url.toString().replace(/\.git$/u, "").replace(/\/$/u, "");
  return normalized.length <= PACKAGE_MARKET_URL_MAX_LENGTH ? normalized : undefined;
}

/** Normalizes one object of an npm `/-/v1/search` response. */
export function normalizeNpmSearchObject(value: unknown): PackageMarketEntry | undefined {
  if (!isRecord(value) || !isRecord(value.package)) return undefined;
  const pkg = value.package;
  if (!isNpmPackageName(pkg.name)) return undefined;
  const version = boundedPackageMarketText(pkg.version, 64);
  if (!version) return undefined;
  const downloads = isRecord(value.downloads) ? value.downloads : {};
  const description = boundedPackageMarketText(pkg.description, PACKAGE_MARKET_DESCRIPTION_MAX_LENGTH);
  const publishedAt = isoDate(pkg.date);
  const publisher = isRecord(pkg.publisher) ? boundedPackageMarketText(pkg.publisher.username, 64) : undefined;
  const license = boundedPackageMarketText(pkg.license, 64);
  const repositoryUrl = isRecord(pkg.links) ? packageMarketRepositoryUrl(pkg.links.repository) : undefined;
  return {
    name: pkg.name,
    version,
    ...(description ? { description } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    monthlyDownloads: count(downloads.monthly),
    weeklyDownloads: count(downloads.weekly),
    ...(publisher ? { publisher } : {}),
    ...(license ? { license } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {})
  };
}

/** Normalizes an npm search response, dropping malformed objects and duplicate names. */
export function normalizeNpmSearchResponse(value: unknown): { entries: PackageMarketEntry[]; total: number } | undefined {
  if (!isRecord(value) || !Array.isArray(value.objects)) return undefined;
  const seen = new Set<string>();
  const entries: PackageMarketEntry[] = [];
  for (const object of value.objects.slice(0, PACKAGE_MARKET_PAGE_SIZE)) {
    const entry = normalizeNpmSearchObject(object);
    if (!entry || seen.has(entry.name)) continue;
    seen.add(entry.name);
    entries.push(entry);
  }
  return { entries, total: Math.max(count(value.total), entries.length) };
}

/** Normalizes an npm `/<name>/latest` manifest; resource types come from its `pi` field. */
export function normalizeNpmLatestManifest(value: unknown, expectedName: string): PackageMarketDetail | undefined {
  if (!isRecord(value) || value.name !== expectedName || !isNpmPackageName(value.name)) return undefined;
  const version = boundedPackageMarketText(value.version, 64);
  if (!version) return undefined;
  const description = boundedPackageMarketText(value.description, PACKAGE_MARKET_DETAIL_DESCRIPTION_MAX_LENGTH);
  const license = boundedPackageMarketText(value.license, 64);
  const repositoryUrl = packageMarketRepositoryUrl(value.repository) ?? packageMarketRepositoryUrl(value.homepage);
  const manifest = isRecord(value.pi) ? value.pi : {};
  const resourceTypes = ([
    ["extensions", "extension"],
    ["skills", "skill"],
    ["prompts", "prompt"],
    ["themes", "theme"]
  ] as const).filter(([key]) => declared(manifest[key])).map(([, type]) => type);
  return {
    name: value.name,
    version,
    ...(description ? { description } : {}),
    ...(license ? { license } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
    resourceTypes
  };
}

export function isRetiredMemoryOwnerName(name: string): boolean {
  return RETIRED_MEMORY_OWNER_IDS.has(name.trim().toLowerCase());
}

/**
 * Whether the marketplace may offer an install. Desktop-native replacements and
 * Context/Memory owners other than the managed OpenViking owner never get one.
 */
export function packageMarketAvailability(
  name: string,
  installedSources: readonly string[]
): PackageMarketAvailability {
  const replacement = nativeCapabilityReplacement(packageMarketInstallSource(name));
  if (replacement) return { kind: "native-replaced", replacement };
  const unscoped = name.slice(name.indexOf("/") + 1);
  if (isRetiredMemoryOwnerName(unscoped) || /openviking/iu.test(name)) return { kind: "memory-conflict" };
  if (installedSources.some((source) => npmSourcePackageName(source) === name)) return { kind: "installed" };
  return { kind: "installable" };
}

export function packageMarketIsStale(entry: Pick<PackageMarketEntry, "publishedAt">, now: number): boolean {
  if (!entry.publishedAt) return false;
  return now - Date.parse(entry.publishedAt) > PACKAGE_MARKET_STALE_AFTER_MS;
}

/** Orders entries for display; `relevance` keeps the registry order. */
export function sortPackageMarketEntries(
  entries: readonly PackageMarketEntry[],
  sort: PackageMarketSort
): PackageMarketEntry[] {
  const copy = [...entries];
  if (sort === "relevance") return copy;
  if (sort === "name") return copy.sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (sort === "updated") {
    return copy.sort((left, right) => (
      (right.publishedAt ? Date.parse(right.publishedAt) : 0) - (left.publishedAt ? Date.parse(left.publishedAt) : 0)
      || right.monthlyDownloads - left.monthlyDownloads
    ));
  }
  return copy.sort((left, right) => (
    right.monthlyDownloads - left.monthlyDownloads || left.name.localeCompare(right.name, "en")
  ));
}

/** Normalizes a user query for the registry; undefined when nothing searchable remains. */
export function normalizePackageMarketQuery(value: unknown): string | undefined {
  const text = boundedPackageMarketText(value, PACKAGE_MARKET_QUERY_MAX_LENGTH + 1);
  if (!text) return undefined;
  return text.length > PACKAGE_MARKET_QUERY_MAX_LENGTH ? text.slice(0, PACKAGE_MARKET_QUERY_MAX_LENGTH) : text;
}

function declared(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
