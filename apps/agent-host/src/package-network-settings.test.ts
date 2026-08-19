import { describe, expect, it, vi } from "vitest";
import { defaultPackageNetworkSettings } from "@pi67/domain";
import {
  NpmRegistryUnavailableError,
  runWithNpmRegistryFallback,
  selectReachableNpmRegistry
} from "./package-network-settings.js";

describe("npm package source selection", () => {
  it("falls back from the public mirror to the official registry", async () => {
    const probe = vi.fn(async (url: string) => url === "https://registry.npmjs.org");

    await expect(selectReachableNpmRegistry(defaultPackageNetworkSettings(), { probe }))
      .resolves.toBe("https://registry.npmjs.org");
    expect(probe.mock.calls.map(([url]) => url)).toEqual([
      "https://registry.npmmirror.com",
      "https://registry.npmjs.org"
    ]);
  });

  it("can require the exact package version instead of accepting a healthy but stale mirror", async () => {
    const probe = vi.fn(async (
      url: string,
      _timeoutMs: number,
      resourcePath: string
    ) => url === "https://registry.npmjs.org" && resourcePath === "/@larksuite%2Fcli/1.0.88");

    await expect(selectReachableNpmRegistry(defaultPackageNetworkSettings(), {
      resourcePath: "/@larksuite%2Fcli/1.0.88",
      probe
    })).resolves.toBe("https://registry.npmjs.org");
    expect(probe).toHaveBeenNthCalledWith(
      1,
      "https://registry.npmmirror.com",
      8_000,
      "/@larksuite%2Fcli/1.0.88"
    );
    expect(probe).toHaveBeenNthCalledWith(
      2,
      "https://registry.npmjs.org",
      8_000,
      "/@larksuite%2Fcli/1.0.88"
    );
  });

  it("falls back when a reachable mirror fails the real package operation", async () => {
    const operation = vi.fn(async (registry: string) => {
      if (registry === "https://registry.npmmirror.com") throw new Error("tarball unavailable");
      return "installed";
    });

    await expect(runWithNpmRegistryFallback(
      defaultPackageNetworkSettings(),
      operation,
      { probe: vi.fn(async () => true) }
    )).resolves.toEqual({
      registry: "https://registry.npmjs.org",
      value: "installed"
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("fails closed when npm sources are disabled", async () => {
    await expect(selectReachableNpmRegistry({
      ...defaultPackageNetworkSettings(),
      npmMode: "offline"
    }, { probe: vi.fn() })).rejects.toEqual(expect.objectContaining({
      name: "NpmRegistryUnavailableError",
      mode: "offline",
      candidateCount: 0,
      reachableCandidateCount: 0
    } satisfies Partial<NpmRegistryUnavailableError>));
  });
});
