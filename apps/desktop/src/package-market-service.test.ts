import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPackageNetworkSettings, type PackageNetworkSettings } from "@pi67/protocol";
import { PackageMarketService, type PackageMarketFetcher } from "./package-market-service.js";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function searchObject(name: string, monthly = 100) {
  return {
    downloads: { monthly, weekly: Math.floor(monthly / 4) },
    package: {
      name,
      version: "1.0.0",
      description: `${name} description`,
      date: "2026-10-01T00:00:00.000Z",
      publisher: { username: "author", email: "author@example.com" },
      links: { repository: `git+https://github.com/author/${name}.git` }
    }
  };
}

function page(names: string[], total = names.length) {
  return { total, objects: names.map((name) => searchObject(name)) };
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("PackageMarketService", () => {
  let userData: string;
  let settings: PackageNetworkSettings;

  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), "pi67-market-"));
    settings = defaultPackageNetworkSettings();
  });

  afterEach(async () => {
    await rm(userData, { recursive: true, force: true });
  });

  function service(fetcher: PackageMarketFetcher, now = () => NOW) {
    return new PackageMarketService({
      userData,
      loadSettings: async () => settings,
      fetcher,
      now,
      createToken: () => "token"
    });
  }

  it("browses the official registry, never the public mirror, and caches the index", async () => {
    const fetcher = vi.fn<PackageMarketFetcher>(async (url) => {
      expect(url.startsWith("https://registry.npmjs.org/-/v1/search?")).toBe(true);
      const from = new URL(url).searchParams.get("from");
      return json(from === "0"
        ? page(Array.from({ length: 250 }, (_, index) => `pi-a-${index}`), 11_415)
        : page(["pi-b-0", "pi-a-0"], 11_415));
    });
    const result = await service(fetcher).browse();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.stale).toBe(false);
    expect(result.index.entries).toHaveLength(251);
    expect(result.index.total).toBe(11_415);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });

    const cache = await readFile(join(userData, "package-manager", "market-index.json"), "utf8");
    expect(cache).not.toContain("@example.com");

    const cachedFetcher = vi.fn<PackageMarketFetcher>();
    const cached = await service(cachedFetcher, () => NOW + 60_000).browse();
    expect(cached.status === "ready" && cached.index.entries.length).toBe(251);
    expect(cachedFetcher).not.toHaveBeenCalled();
  });

  it("serves the stale cache with a notice when the network fails, and reports unavailable without one", async () => {
    const failing = vi.fn<PackageMarketFetcher>(async () => { throw new Error("offline"); });
    expect(await service(failing).browse()).toEqual({ status: "unavailable", reason: "network" });

    await service(async () => json(page(["pi-one"]))).browse();
    const later = await service(failing, () => NOW + 7 * 60 * 60 * 1_000).browse();
    expect(later).toMatchObject({ status: "ready", stale: true, notice: "network" });
  });

  it("refreshes a fresh cache only when asked", async () => {
    await service(async () => json(page(["pi-one"]))).browse();
    const fetcher = vi.fn<PackageMarketFetcher>(async () => json(page(["pi-two"])));
    const refreshed = await service(fetcher).browse({ refresh: true });
    expect(refreshed.status === "ready" && refreshed.index.entries.map((entry) => entry.name)).toEqual(["pi-two"]);
  });

  it("respects offline and mirror-only download sources", async () => {
    const fetcher = vi.fn<PackageMarketFetcher>();
    settings = { ...settings, npmMode: "offline" };
    expect(await service(fetcher).browse()).toEqual({ status: "unavailable", reason: "offline" });
    expect(await service(fetcher).detail("pi-one")).toEqual({ status: "unavailable", name: "pi-one", reason: "offline" });
    settings = { ...settings, npmMode: "mirror-only" };
    expect(await service(fetcher).search("memory")).toEqual({ status: "unavailable", query: "memory", reason: "mirror-only" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects oversized, redirected and malformed responses", async () => {
    const oversized = await service(async () => new Response("{}", {
      headers: { "content-length": String(3 * 1_024 * 1_024) }
    })).browse();
    expect(oversized).toEqual({ status: "unavailable", reason: "network" });
    const notFound = await service(async () => new Response("nope", { status: 404 })).browse();
    expect(notFound).toEqual({ status: "unavailable", reason: "network" });
    const malformed = await service(async () => new Response("<html>")).browse();
    expect(malformed).toEqual({ status: "unavailable", reason: "network" });
  });

  it("ignores a tampered cache file", async () => {
    await mkdir(join(userData, "package-manager"), { recursive: true });
    await writeFile(join(userData, "package-manager", "market-index.json"), JSON.stringify({
      schema: "pi67.package-market-index.v1",
      index: { entries: [{ name: "../evil", version: "1", monthlyDownloads: 0, weeklyDownloads: 0 }], total: 1, fetchedAt: new Date(NOW).toISOString() }
    }));
    const fetcher = vi.fn<PackageMarketFetcher>(async () => json(page(["pi-one"])));
    const result = await service(fetcher).browse();
    expect(fetcher).toHaveBeenCalled();
    expect(result.status === "ready" && result.index.entries.map((entry) => entry.name)).toEqual(["pi-one"]);
  });

  it("searches with the Pi package keyword and caps results", async () => {
    const fetcher = vi.fn<PackageMarketFetcher>(async () => json(page(["pi-memory"], 3)));
    const result = await service(fetcher).search("  memory ");
    const url = new URL(fetcher.mock.calls[0]![0]);
    expect(url.searchParams.get("text")).toBe("memory keywords:pi-package");
    expect(url.searchParams.get("size")).toBe("50");
    expect(result).toMatchObject({ status: "ready", query: "memory", total: 3 });
  });

  it("reads detail through the download sources, mirror first, falling back on failure", async () => {
    const fetcher = vi.fn<PackageMarketFetcher>(async (url) => (
      url.startsWith("https://registry.npmmirror.com")
        ? new Response("busy", { status: 503 })
        : json({ name: "@a/pi-one", version: "2.0.0", pi: { extensions: ["./index.ts"] } })
    ));
    const result = await service(fetcher).detail("@a/pi-one");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://registry.npmmirror.com/@a%2fpi-one/latest",
      "https://registry.npmjs.org/@a%2fpi-one/latest"
    ]);
    expect(result).toEqual({
      status: "ready",
      detail: { name: "@a/pi-one", version: "2.0.0", resourceTypes: ["extension"] }
    });
  });
});
