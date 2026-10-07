import { parsePackageMarketDetailRequest, parsePackageMarketSearchRequest, type PackageNetworkSettings } from "@pi67/protocol";
import type { AuthorizedIpcHandle } from "./authorized-ipc.js";
import { PackageMarketService, type PackageMarketFetcher } from "./package-market-service.js";

/** Registers the Extension marketplace channels; requests are validated before settings or network work. */
export function registerPackageMarketBridge(
  handle: AuthorizedIpcHandle,
  loadSettings: () => Promise<PackageNetworkSettings>,
  runtime: { getUserData: () => string; fetcher: PackageMarketFetcher }
): void {
  // Created on first use so registering the bridge reads no Electron paths.
  let service: PackageMarketService | undefined;
  const market = () => service ??= new PackageMarketService({
    userData: runtime.getUserData(),
    loadSettings,
    fetcher: runtime.fetcher
  });
  handle("pi67:package-market-browse", (_event, value: unknown) => {
    if (value !== undefined && !isRefreshOption(value)) throw new Error("Package marketplace options are invalid.");
    return market().browse({ refresh: value?.refresh === true });
  });
  handle("pi67:package-market-search", (_event, value: unknown) => {
    const request = parsePackageMarketSearchRequest(value);
    if (!request) throw new Error("Package marketplace query is invalid.");
    return market().search(request.query);
  });
  handle("pi67:package-market-detail", (_event, value: unknown) => {
    const request = parsePackageMarketDetailRequest(value);
    if (!request) throw new Error("Package marketplace name is invalid.");
    return market().detail(request.name);
  });
}

function isRefreshOption(value: unknown): value is { refresh?: boolean } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => key === "refresh")
    && (!("refresh" in value) || typeof value.refresh === "boolean");
}
