import type { DesktopRecommendedPackage, PackageMarketEntry } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  buildPackageMarketRows,
  formatIndexAge,
  formatMonthlyDownloads,
  formatPublishedAge
} from "./package-market-model.js";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

const curated: DesktopRecommendedPackage[] = [{
  id: "pi-rewind",
  source: "https://github.com/arpagon/pi-rewind.git",
  installPolicy: "user-initiated",
  admissionPolicy: "user-approval"
}, {
  id: "pi-curated-npm",
  source: "npm:pi-curated-npm",
  installPolicy: "user-initiated",
  admissionPolicy: "user-approval"
}];

function entry(name: string, monthlyDownloads: number, publishedAt?: string, description?: string): PackageMarketEntry {
  return {
    name,
    version: "1.0.0",
    monthlyDownloads,
    weeklyDownloads: 0,
    ...(publishedAt ? { publishedAt } : {}),
    ...(description ? { description } : {})
  };
}

describe("package market rows", () => {
  it("leads with curated rows and keeps them out of the community list", () => {
    const rows = buildPackageMarketRows({
      curated,
      entries: [entry("pi-curated-npm", 900, "2026-10-01T00:00:00.000Z"), entry("pi-other", 100, undefined, "Other")],
      installedSources: ["https://github.com/arpagon/pi-rewind.git"],
      sort: "popular",
      query: "",
      now: NOW
    });
    expect(rows.curated.map((row) => [row.name, row.availability.kind, row.meta])).toEqual([
      ["pi-rewind", "installed", "github.com/arpagon/pi-rewind"],
      ["pi-curated-npm", "installable", "900/月 · 6天前更新"]
    ]);
    expect(rows.curated[0]?.registryName).toBeUndefined();
    expect(rows.community.map((row) => row.name)).toEqual(["pi-other"]);
    expect(rows.community[0]?.source).toBe("npm:pi-other");
    expect(rows.community[0]?.description).toBe("Other");
  });

  it("classifies exceptions and filters curated rows by the query", () => {
    const rows = buildPackageMarketRows({
      curated,
      entries: [
        entry("pi-web-access", 10),
        entry("pi-hy-memory", 10),
        entry("pi-old", 10, "2024-01-01T00:00:00.000Z")
      ],
      installedSources: [],
      sort: "relevance",
      query: "memory",
      now: NOW
    });
    expect(rows.curated).toEqual([]);
    expect(rows.community.map((row) => [row.name, row.availability.kind, row.stale])).toEqual([
      ["pi-web-access", "native-replaced", false],
      ["pi-hy-memory", "memory-conflict", false],
      ["pi-old", "installable", true]
    ]);
  });
});

describe("package market formatting", () => {
  it("formats counts and ages for the zh-CN locale", () => {
    expect(formatMonthlyDownloads(603_369)).toBe("60.3万/月");
    expect(formatMonthlyDownloads(4_465)).toBe("4465/月");
    expect(formatPublishedAge("2026-10-07T06:00:00.000Z", NOW)).toBe("今天更新");
    expect(formatPublishedAge("2026-07-01T00:00:00.000Z", NOW)).toBe("3个月前更新");
    expect(formatPublishedAge(undefined, NOW)).toBeUndefined();
    expect(formatIndexAge("2026-10-07T09:00:00.000Z", NOW)).toBe("3 小时前");
  });
});
