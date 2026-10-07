import { describe, expect, it } from "vitest";
import {
  PACKAGE_MARKET_DESCRIPTION_MAX_LENGTH,
  PACKAGE_MARKET_PAGE_SIZE,
  boundedPackageMarketText,
  normalizeNpmLatestManifest,
  normalizeNpmSearchObject,
  normalizeNpmSearchResponse,
  normalizePackageMarketQuery,
  npmSourcePackageName,
  packageMarketAvailability,
  packageMarketIsStale,
  packageMarketRepositoryUrl,
  sortPackageMarketEntries,
  type PackageMarketEntry
} from "./package-market.js";

function searchObject(overrides: Record<string, unknown> = {}, pkg: Record<string, unknown> = {}) {
  return {
    downloads: { monthly: 1_200, weekly: 300 },
    package: {
      name: "pi-example",
      version: "1.2.3",
      description: "Example package",
      date: "2026-10-01T00:00:00.000Z",
      license: "MIT",
      publisher: { username: "author", email: "author@example.com" },
      links: { repository: "git+https://github.com/author/pi-example.git", npm: "https://www.npmjs.com/package/pi-example" },
      ...pkg
    },
    ...overrides
  };
}

describe("package market normalization", () => {
  it("keeps bounded public fields and drops the publisher email", () => {
    const entry = normalizeNpmSearchObject(searchObject());
    expect(entry).toEqual({
      name: "pi-example",
      version: "1.2.3",
      description: "Example package",
      publishedAt: "2026-10-01T00:00:00.000Z",
      monthlyDownloads: 1_200,
      weeklyDownloads: 300,
      publisher: "author",
      license: "MIT",
      repositoryUrl: "https://github.com/author/pi-example"
    });
    expect(JSON.stringify(entry)).not.toContain("@example.com");
  });

  it("rejects invalid names and versions", () => {
    expect(normalizeNpmSearchObject(searchObject({}, { name: "../evil" }))).toBeUndefined();
    expect(normalizeNpmSearchObject(searchObject({}, { name: "UPPER" }))).toBeUndefined();
    expect(normalizeNpmSearchObject(searchObject({}, { version: "" }))).toBeUndefined();
    expect(normalizeNpmSearchObject({ package: null })).toBeUndefined();
  });

  it("strips control, bidi and zero-width characters and truncates long text", () => {
    expect(boundedPackageMarketText("a\u0000b‮c​d\n e", 50)).toBe("a b c d e");
    const long = normalizeNpmSearchObject(searchObject({}, { description: "x".repeat(1_000) }));
    expect(long?.description).toHaveLength(PACKAGE_MARKET_DESCRIPTION_MAX_LENGTH);
    expect(long?.description?.endsWith("…")).toBe(true);
  });

  it("treats hostile download counts and dates as absent", () => {
    const entry = normalizeNpmSearchObject(searchObject({ downloads: { monthly: -5, weekly: "9" } }, { date: "never" }));
    expect(entry?.monthlyDownloads).toBe(0);
    expect(entry?.weeklyDownloads).toBe(0);
    expect(entry?.publishedAt).toBeUndefined();
  });

  it("accepts only credential-free https repository links", () => {
    expect(packageMarketRepositoryUrl("javascript:alert(1)")).toBeUndefined();
    expect(packageMarketRepositoryUrl("http://github.com/a/b")).toBeUndefined();
    expect(packageMarketRepositoryUrl("https://user:pass@github.com/a/b")).toBeUndefined();
    expect(packageMarketRepositoryUrl("https://localhost/a")).toBeUndefined();
    expect(packageMarketRepositoryUrl({ type: "git", url: "git+https://github.com/a/b.git#main" }))
      .toBe("https://github.com/a/b");
  });

  it("caps a response page, removes duplicates and keeps the reported total", () => {
    const objects = Array.from({ length: PACKAGE_MARKET_PAGE_SIZE + 10 }, (_, index) => (
      searchObject({}, { name: `pi-example-${index}` })
    ));
    objects.push(searchObject({}, { name: "pi-example-1" }));
    const page = normalizeNpmSearchResponse({ total: 11_415, objects });
    expect(page?.entries).toHaveLength(PACKAGE_MARKET_PAGE_SIZE);
    expect(page?.total).toBe(11_415);
    expect(normalizeNpmSearchResponse({ objects: "nope" })).toBeUndefined();
  });

  it("reads declared resource types from the latest manifest", () => {
    const detail = normalizeNpmLatestManifest({
      name: "pi-example",
      version: "2.0.0",
      description: "Full description",
      license: "Apache-2.0",
      repository: { url: "git+https://github.com/author/pi-example.git" },
      pi: { extensions: ["./index.ts"], skills: "./skills", prompts: [], image: "https://example.com/x.png" }
    }, "pi-example");
    expect(detail).toEqual({
      name: "pi-example",
      version: "2.0.0",
      description: "Full description",
      license: "Apache-2.0",
      repositoryUrl: "https://github.com/author/pi-example",
      resourceTypes: ["extension", "skill"]
    });
    expect(normalizeNpmLatestManifest({ name: "other", version: "1.0.0" }, "pi-example")).toBeUndefined();
  });

  it("normalizes queries", () => {
    expect(normalizePackageMarketQuery("  memory \n")).toBe("memory");
    expect(normalizePackageMarketQuery("   ")).toBeUndefined();
    expect(normalizePackageMarketQuery("a".repeat(500))).toHaveLength(100);
  });
});

describe("package market availability", () => {
  it("never offers native-replaced packages or conflicting memory owners", () => {
    expect(packageMarketAvailability("pi-web-access", [])).toEqual({ kind: "native-replaced", replacement: "native-web" });
    expect(packageMarketAvailability("pi-mcp-adapter", [])).toEqual({ kind: "native-replaced", replacement: "native-mcp" });
    expect(packageMarketAvailability("pi-hy-memory", [])).toEqual({ kind: "memory-conflict" });
    expect(packageMarketAvailability("@scope/pi-observational-memory", [])).toEqual({ kind: "memory-conflict" });
    expect(packageMarketAvailability("pi-openviking-memory", [])).toEqual({ kind: "memory-conflict" });
  });

  it("recognizes installed npm sources with or without a version", () => {
    expect(packageMarketAvailability("pi-example", ["npm:pi-example@1.0.0"])).toEqual({ kind: "installed" });
    expect(packageMarketAvailability("@a/pi-example", ["npm:@a/pi-example"])).toEqual({ kind: "installed" });
    expect(packageMarketAvailability("pi-example", ["npm:pi-example-two", "git:github.com/a/pi-example"]))
      .toEqual({ kind: "installable" });
    expect(npmSourcePackageName("npm:@a/b@latest")).toBe("@a/b");
    expect(npmSourcePackageName("git:github.com/a/b")).toBeUndefined();
  });

  it("flags packages without a publish for a year", () => {
    const now = Date.parse("2026-10-07T00:00:00.000Z");
    expect(packageMarketIsStale({ publishedAt: "2025-09-01T00:00:00.000Z" }, now)).toBe(true);
    expect(packageMarketIsStale({ publishedAt: "2026-01-01T00:00:00.000Z" }, now)).toBe(false);
    expect(packageMarketIsStale({}, now)).toBe(false);
  });
});

describe("package market sorting", () => {
  const entries: PackageMarketEntry[] = [
    { name: "b", version: "1", monthlyDownloads: 10, weeklyDownloads: 1, publishedAt: "2026-01-01T00:00:00.000Z" },
    { name: "a", version: "1", monthlyDownloads: 50, weeklyDownloads: 1, publishedAt: "2025-01-01T00:00:00.000Z" },
    { name: "c", version: "1", monthlyDownloads: 10, weeklyDownloads: 1 }
  ];

  it("orders by downloads, date, name, or keeps relevance order", () => {
    expect(sortPackageMarketEntries(entries, "popular").map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(sortPackageMarketEntries(entries, "updated").map((entry) => entry.name)).toEqual(["b", "a", "c"]);
    expect(sortPackageMarketEntries(entries, "name").map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(sortPackageMarketEntries(entries, "relevance").map((entry) => entry.name)).toEqual(["b", "a", "c"]);
    expect(entries[0]?.name).toBe("b");
  });
});
