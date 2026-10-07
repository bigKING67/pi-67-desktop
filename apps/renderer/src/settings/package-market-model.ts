import {
  npmSourcePackageName,
  packageMarketAvailability,
  packageMarketInstallSource,
  packageMarketIsStale,
  sortPackageMarketEntries,
  type DesktopRecommendedPackage,
  type PackageMarketAvailability,
  type PackageMarketEntry,
  type PackageMarketSort
} from "@pi67/domain";
import {
  parsePackageMarketBrowseResult,
  parsePackageMarketDetailResult,
  parsePackageMarketSearchResult,
  type PackageMarketBrowseResult,
  type PackageMarketDetailResult,
  type PackageMarketSearchResult
} from "@pi67/protocol";
import { appLocale, messages } from "../localization/message-catalog.js";

export const PACKAGE_MARKET_STEP = 50;

export interface PackageMarketRow {
  key: string;
  name: string;
  description: string;
  /** Install source passed to the existing confirmation dialog. */
  source: string;
  meta: string;
  availability: PackageMarketAvailability;
  stale: boolean;
  /** Registry name used for the detail request; absent for non-npm curated sources. */
  registryName?: string;
}

export const PACKAGE_MARKET_SORT_LABELS: Readonly<Record<PackageMarketSort, string>> = {
  popular: "热门",
  updated: "最近更新",
  name: "名称",
  relevance: "相关度"
};

const compactCount = new Intl.NumberFormat(appLocale, { notation: "compact", maximumFractionDigits: 1 });
const relativeTime = new Intl.RelativeTimeFormat(appLocale, { numeric: "auto" });
const DAY_MS = 24 * 60 * 60 * 1_000;

export function formatMonthlyDownloads(count: number): string {
  return `${compactCount.format(count)}/月`;
}

export function formatPublishedAge(publishedAt: string | undefined, now: number): string | undefined {
  if (!publishedAt) return undefined;
  const days = Math.max(0, Math.floor((now - Date.parse(publishedAt)) / DAY_MS));
  if (days < 1) return "今天更新";
  if (days < 30) return `${relativeTime.format(-days, "day")}更新`;
  if (days < 365) return `${relativeTime.format(-Math.floor(days / 30), "month")}更新`;
  return `${relativeTime.format(-Math.floor(days / 365), "year")}更新`;
}

export function formatIndexAge(fetchedAt: string, now: number): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / (60 * 60 * 1_000)));
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function entryMeta(entry: PackageMarketEntry, now: number): string {
  return [formatMonthlyDownloads(entry.monthlyDownloads), formatPublishedAge(entry.publishedAt, now)]
    .filter(Boolean)
    .join(" · ");
}

function communityRow(entry: PackageMarketEntry, installedSources: readonly string[], now: number): PackageMarketRow {
  return {
    key: `community:${entry.name}`,
    name: entry.name,
    description: messages.settings.extensionPackages.marketDescription(entry.name, entry.description ?? ""),
    source: packageMarketInstallSource(entry.name),
    meta: entryMeta(entry, now),
    availability: packageMarketAvailability(entry.name, installedSources),
    stale: packageMarketIsStale(entry, now),
    registryName: entry.name
  };
}

function curatedRow(
  recommendation: DesktopRecommendedPackage,
  installedSources: readonly string[],
  indexed: PackageMarketEntry | undefined,
  now: number
): PackageMarketRow {
  const registryName = npmSourcePackageName(recommendation.source);
  return {
    key: `curated:${recommendation.id}`,
    name: recommendation.id,
    description: messages.settings.extensionPackages.purpose(recommendation.source, recommendation.id, undefined),
    source: recommendation.source,
    meta: indexed ? entryMeta(indexed, now) : curatedSourceLabel(recommendation.source),
    availability: installedSources.includes(recommendation.source) ? { kind: "installed" } : { kind: "installable" },
    stale: false,
    ...(registryName ? { registryName } : {})
  };
}

/** Curated recommendations lead; community rows exclude anything already curated. */
export function buildPackageMarketRows(options: {
  curated: readonly DesktopRecommendedPackage[];
  entries: readonly PackageMarketEntry[];
  installedSources: readonly string[];
  sort: PackageMarketSort;
  query: string;
  now: number;
}): { curated: PackageMarketRow[]; community: PackageMarketRow[] } {
  const byName = new Map(options.entries.map((entry) => [entry.name, entry]));
  const curatedNames = new Set<string>();
  const needle = options.query.trim().toLocaleLowerCase();
  const curated = options.curated
    .map((recommendation) => {
      const registryName = npmSourcePackageName(recommendation.source);
      if (registryName) curatedNames.add(registryName);
      curatedNames.add(recommendation.id);
      return curatedRow(
        recommendation,
        options.installedSources,
        registryName ? byName.get(registryName) : undefined,
        options.now
      );
    })
    .filter((row) => needle.length === 0
      || row.name.toLocaleLowerCase().includes(needle)
      || row.description.toLocaleLowerCase().includes(needle));
  const community = sortPackageMarketEntries(
    options.entries.filter((entry) => !curatedNames.has(entry.name)),
    options.sort
  ).map((entry) => communityRow(entry, options.installedSources, options.now));
  return { curated, community };
}

function curatedSourceLabel(source: string): string {
  const match = /^(?:git:|https:\/\/)?(github\.com\/[^/\s]+\/[^/\s#?]+?)(?:\.git)?(?:[#?].*)?$/u.exec(source.trim());
  return match?.[1] ?? source;
}

// The bridge result is untrusted until it passes the protocol schema.
export async function browsePackageMarket(refresh = false): Promise<PackageMarketBrowseResult> {
  const value = await window.pi67.system.packageMarket.browse(refresh ? { refresh: true } : undefined);
  return parsePackageMarketBrowseResult(value) ?? { status: "unavailable", reason: "network" };
}

export async function searchPackageMarket(query: string): Promise<PackageMarketSearchResult> {
  const value = await window.pi67.system.packageMarket.search({ query });
  return parsePackageMarketSearchResult(value) ?? { status: "unavailable", query, reason: "network" };
}

export async function getPackageMarketDetail(name: string): Promise<PackageMarketDetailResult> {
  const value = await window.pi67.system.packageMarket.detail({ name });
  return parsePackageMarketDetailResult(value) ?? { status: "unavailable", name, reason: "network" };
}
