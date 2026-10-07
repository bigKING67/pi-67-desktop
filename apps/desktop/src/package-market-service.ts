import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  PACKAGE_MARKET_BROWSE_LIMIT,
  PACKAGE_MARKET_INDEX_FRESH_MS,
  PACKAGE_MARKET_KEYWORD,
  PACKAGE_MARKET_PAGE_SIZE,
  PACKAGE_MARKET_SEARCH_LIMIT,
  normalizeNpmLatestManifest,
  normalizeNpmSearchResponse,
  normalizePackageMarketQuery,
  npmRegistryCandidates,
  parsePackageMarketBrowseResult,
  type PackageMarketBrowseResult,
  type PackageMarketDetailResult,
  type PackageMarketEntry,
  type PackageMarketIndex,
  type PackageMarketSearchResult,
  type PackageMarketUnavailableReason,
  type PackageNetworkSettings
} from "@pi67/protocol";
import { readBoundedResponseText } from "./bounded-response-text.js";
import { PACKAGE_NETWORK_DIRECTORY } from "./package-network-settings.js";

const MARKET_INDEX_FILENAME = "market-index.json";
const MARKET_INDEX_SCHEMA = "pi67.package-market-index.v1";
const MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;
const MAX_CACHE_BYTES = 2 * 1_024 * 1_024;
const REQUEST_TIMEOUT_MS = 10_000;

export type PackageMarketFetcher = (input: string, init: RequestInit) => Promise<Response>;

export interface PackageMarketServiceOptions {
  userData: string;
  loadSettings: () => Promise<PackageNetworkSettings>;
  fetcher: PackageMarketFetcher;
  now?: () => number;
  createToken?: () => string;
}

/**
 * Main-owned read access to public npm registry metadata for the Extension marketplace.
 * Search goes only to registries that answer `/-/v1/search` (the public mirror does not);
 * manifests follow the configured download sources. Nothing here installs a Package.
 */
export class PackageMarketService {
  readonly #cachePath: string;
  readonly #loadSettings: () => Promise<PackageNetworkSettings>;
  readonly #fetcher: PackageMarketFetcher;
  readonly #now: () => number;
  readonly #createToken: () => string;
  #browseInFlight: Promise<PackageMarketBrowseResult> | undefined;

  constructor(options: PackageMarketServiceOptions) {
    if (typeof options.userData !== "string" || options.userData.length === 0 || options.userData.includes("\0")) {
      throw new Error("Electron userData path is invalid.");
    }
    this.#cachePath = join(resolve(options.userData), PACKAGE_NETWORK_DIRECTORY, MARKET_INDEX_FILENAME);
    this.#loadSettings = options.loadSettings;
    this.#fetcher = options.fetcher;
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
  }

  browse(options: { refresh?: boolean } = {}): Promise<PackageMarketBrowseResult> {
    this.#browseInFlight ??= this.#browse(options.refresh === true).finally(() => {
      this.#browseInFlight = undefined;
    });
    return this.#browseInFlight;
  }

  async search(rawQuery: string): Promise<PackageMarketSearchResult> {
    const query = normalizePackageMarketQuery(rawQuery);
    if (!query) throw new Error("Package marketplace query is empty.");
    const settings = await this.#loadSettings();
    const registries = searchRegistries(settings);
    if (registries.length === 0) return { status: "unavailable", query, reason: searchUnavailableReason(settings) };
    for (const registry of registries) {
      const page = await this.#searchPage(registry, `${query} keywords:${PACKAGE_MARKET_KEYWORD}`, 0, PACKAGE_MARKET_SEARCH_LIMIT);
      if (page) return { status: "ready", query, entries: page.entries.slice(0, PACKAGE_MARKET_SEARCH_LIMIT), total: page.total };
    }
    return { status: "unavailable", query, reason: "network" };
  }

  async detail(name: string): Promise<PackageMarketDetailResult> {
    const settings = await this.#loadSettings();
    const registries = npmRegistryCandidates(settings).map((candidate) => candidate.url);
    if (registries.length === 0) return { status: "unavailable", name, reason: "offline" };
    for (const registry of registries) {
      const value = await this.#fetchJson(`${registry}/${name.replace("/", "%2f")}/latest`);
      const detail = value === undefined ? undefined : normalizeNpmLatestManifest(value, name);
      if (detail) return { status: "ready", detail };
    }
    return { status: "unavailable", name, reason: "network" };
  }

  async #browse(refresh: boolean): Promise<PackageMarketBrowseResult> {
    const cached = await this.#readCache();
    const fresh = cached !== undefined && this.#now() - Date.parse(cached.fetchedAt) < PACKAGE_MARKET_INDEX_FRESH_MS;
    if (cached && fresh && !refresh) return { status: "ready", index: cached, stale: false };
    const settings = await this.#loadSettings();
    const registries = searchRegistries(settings);
    if (registries.length === 0) return fallback(cached, searchUnavailableReason(settings));
    for (const registry of registries) {
      const index = await this.#fetchIndex(registry);
      if (!index) continue;
      await this.#writeCache(index).catch(() => undefined);
      return { status: "ready", index, stale: false };
    }
    return fallback(cached, "network");
  }

  async #fetchIndex(registry: string): Promise<PackageMarketIndex | undefined> {
    const entries: PackageMarketEntry[] = [];
    const seen = new Set<string>();
    let total = 0;
    for (let from = 0; from < PACKAGE_MARKET_BROWSE_LIMIT; from += PACKAGE_MARKET_PAGE_SIZE) {
      const page = await this.#searchPage(registry, `keywords:${PACKAGE_MARKET_KEYWORD}`, from, PACKAGE_MARKET_PAGE_SIZE);
      // A failed first page means this registry cannot serve the index; a later page only truncates it.
      if (!page) {
        if (from === 0) return undefined;
        break;
      }
      total = Math.max(total, page.total);
      for (const entry of page.entries) {
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);
        entries.push(entry);
      }
      if (page.entries.length < PACKAGE_MARKET_PAGE_SIZE) break;
    }
    // A registry that answers search with no Pi Packages does not index them (e.g. a mirror).
    if (entries.length === 0) return undefined;
    return { entries: entries.slice(0, PACKAGE_MARKET_BROWSE_LIMIT), total, fetchedAt: new Date(this.#now()).toISOString() };
  }

  async #searchPage(registry: string, text: string, from: number, size: number) {
    const url = new URL(`${registry}/-/v1/search`);
    url.searchParams.set("text", text);
    url.searchParams.set("size", String(size));
    url.searchParams.set("from", String(from));
    const value = await this.#fetchJson(url.toString());
    return value === undefined ? undefined : normalizeNpmSearchResponse(value);
  }

  async #fetchJson(url: string): Promise<unknown> {
    try {
      const response = await this.#fetcher(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      return JSON.parse(await readBoundedResponseText(response, MAX_RESPONSE_BYTES)) as unknown;
    } catch {
      return undefined;
    }
  }

  async #readCache(): Promise<PackageMarketIndex | undefined> {
    try {
      const metadata = await stat(this.#cachePath);
      if (!metadata.isFile() || metadata.size > MAX_CACHE_BYTES) return undefined;
      const value = JSON.parse(await readFile(this.#cachePath, "utf8")) as unknown;
      if (!isRecord(value) || value.schema !== MARKET_INDEX_SCHEMA) return undefined;
      const parsed = parsePackageMarketBrowseResult({ status: "ready", index: value.index, stale: false });
      return parsed?.status === "ready" && !Number.isNaN(Date.parse(parsed.index.fetchedAt)) ? parsed.index : undefined;
    } catch {
      return undefined;
    }
  }

  async #writeCache(index: PackageMarketIndex): Promise<void> {
    const directory = join(this.#cachePath, "..");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.market-index.${process.pid}.${this.#createToken()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ schema: MARKET_INDEX_SCHEMA, index })}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.#cachePath);
    if (process.platform !== "win32") await chmod(this.#cachePath, 0o600);
  }
}

function searchRegistries(settings: PackageNetworkSettings): string[] {
  return npmRegistryCandidates(settings)
    .filter((candidate) => candidate.role !== "public-mirror")
    .map((candidate) => candidate.url);
}

function searchUnavailableReason(settings: PackageNetworkSettings): PackageMarketUnavailableReason {
  return settings.npmMode === "offline" ? "offline" : "mirror-only";
}

function fallback(
  cached: PackageMarketIndex | undefined,
  reason: PackageMarketUnavailableReason
): PackageMarketBrowseResult {
  return cached ? { status: "ready", index: cached, stale: true, notice: reason } : { status: "unavailable", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
