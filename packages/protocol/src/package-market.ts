import {
  PACKAGE_MARKET_BROWSE_LIMIT,
  PACKAGE_MARKET_DESCRIPTION_MAX_LENGTH,
  PACKAGE_MARKET_DETAIL_DESCRIPTION_MAX_LENGTH,
  PACKAGE_MARKET_QUERY_MAX_LENGTH,
  PACKAGE_MARKET_SEARCH_LIMIT,
  PACKAGE_MARKET_URL_MAX_LENGTH,
  isNpmPackageName,
  packageMarketRepositoryUrl,
  type PackageMarketBrowseResult,
  type PackageMarketDetailResult,
  type PackageMarketSearchResult
} from "@pi67/domain";
import { strictObject, Type, Value } from "./typebox-schema.js";

/** Main -> renderer results of the pi67:package-market-* invoke channels. */

const name = Type.String({ minLength: 1, maxLength: 214 });
const version = Type.String({ minLength: 1, maxLength: 64 });
const shortText = Type.String({ minLength: 1, maxLength: 64 });
const url = Type.String({ minLength: 1, maxLength: PACKAGE_MARKET_URL_MAX_LENGTH });
const timestamp = Type.String({ minLength: 1, maxLength: 64 });
const downloads = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const reason = Type.Union([Type.Literal("offline"), Type.Literal("mirror-only"), Type.Literal("network")]);
const query = Type.String({ minLength: 1, maxLength: PACKAGE_MARKET_QUERY_MAX_LENGTH });

const PackageMarketEntrySchema = strictObject({
  name,
  version,
  description: Type.Optional(Type.String({ minLength: 1, maxLength: PACKAGE_MARKET_DESCRIPTION_MAX_LENGTH })),
  publishedAt: Type.Optional(timestamp),
  monthlyDownloads: downloads,
  weeklyDownloads: downloads,
  publisher: Type.Optional(shortText),
  license: Type.Optional(shortText),
  repositoryUrl: Type.Optional(url)
});

export const PackageMarketBrowseResultSchema = Type.Union([
  strictObject({
    status: Type.Literal("ready"),
    index: strictObject({
      entries: Type.Array(PackageMarketEntrySchema, { maxItems: PACKAGE_MARKET_BROWSE_LIMIT }),
      total: downloads,
      fetchedAt: timestamp
    }),
    stale: Type.Boolean(),
    notice: Type.Optional(reason)
  }),
  strictObject({ status: Type.Literal("unavailable"), reason })
]);

export const PackageMarketSearchRequestSchema = strictObject({ query });

export const PackageMarketSearchResultSchema = Type.Union([
  strictObject({
    status: Type.Literal("ready"),
    query,
    entries: Type.Array(PackageMarketEntrySchema, { maxItems: PACKAGE_MARKET_SEARCH_LIMIT }),
    total: downloads
  }),
  strictObject({ status: Type.Literal("unavailable"), query, reason })
]);

export const PackageMarketDetailRequestSchema = strictObject({ name });

export const PackageMarketDetailResultSchema = Type.Union([
  strictObject({
    status: Type.Literal("ready"),
    detail: strictObject({
      name,
      version,
      description: Type.Optional(Type.String({ minLength: 1, maxLength: PACKAGE_MARKET_DETAIL_DESCRIPTION_MAX_LENGTH })),
      license: Type.Optional(shortText),
      repositoryUrl: Type.Optional(url),
      resourceTypes: Type.Array(Type.Union([
        Type.Literal("extension"),
        Type.Literal("skill"),
        Type.Literal("prompt"),
        Type.Literal("theme")
      ]), { maxItems: 4 })
    })
  }),
  strictObject({ status: Type.Literal("unavailable"), name, reason })
]);

export interface PackageMarketBridge {
  browse(options?: { refresh?: boolean }): Promise<PackageMarketBrowseResult>;
  search(request: { query: string }): Promise<PackageMarketSearchResult>;
  detail(request: { name: string }): Promise<PackageMarketDetailResult>;
}

export function parsePackageMarketBrowseResult(value: unknown): PackageMarketBrowseResult | undefined {
  if (!Value.Check(PackageMarketBrowseResultSchema, value)) return undefined;
  if (value.status === "ready" && !value.index.entries.every(validEntry)) return undefined;
  return value;
}

export function parsePackageMarketSearchResult(value: unknown): PackageMarketSearchResult | undefined {
  if (!Value.Check(PackageMarketSearchResultSchema, value)) return undefined;
  if (value.status === "ready" && !value.entries.every(validEntry)) return undefined;
  return value;
}

export function parsePackageMarketDetailResult(value: unknown): PackageMarketDetailResult | undefined {
  if (!Value.Check(PackageMarketDetailResultSchema, value)) return undefined;
  if (value.status === "ready" && !(isNpmPackageName(value.detail.name) && validRepository(value.detail.repositoryUrl))) {
    return undefined;
  }
  if (value.status === "unavailable" && !isNpmPackageName(value.name)) return undefined;
  return value;
}

export function parsePackageMarketSearchRequest(value: unknown): { query: string } | undefined {
  return Value.Check(PackageMarketSearchRequestSchema, value) ? { query: value.query } : undefined;
}

export function parsePackageMarketDetailRequest(value: unknown): { name: string } | undefined {
  return Value.Check(PackageMarketDetailRequestSchema, value) && isNpmPackageName(value.name)
    ? { name: value.name }
    : undefined;
}

function validEntry(entry: { name: string; repositoryUrl?: string }): boolean {
  return isNpmPackageName(entry.name) && validRepository(entry.repositoryUrl);
}

/** A repository link must already be in its normalized `https:` form. */
function validRepository(value: string | undefined): boolean {
  return value === undefined || packageMarketRepositoryUrl(value) === value;
}

export {
  PACKAGE_MARKET_BROWSE_LIMIT,
  PACKAGE_MARKET_INDEX_FRESH_MS,
  PACKAGE_MARKET_KEYWORD,
  PACKAGE_MARKET_PAGE_SIZE,
  PACKAGE_MARKET_SEARCH_LIMIT,
  normalizeNpmLatestManifest,
  normalizeNpmSearchResponse,
  normalizePackageMarketQuery,
  type PackageMarketBrowseResult,
  type PackageMarketDetailResult,
  type PackageMarketEntry,
  type PackageMarketIndex,
  type PackageMarketSearchResult,
  type PackageMarketUnavailableReason
} from "@pi67/domain";
