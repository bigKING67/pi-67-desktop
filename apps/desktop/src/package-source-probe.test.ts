import { describe, expect, it } from "vitest";
import { defaultPackageNetworkSettings } from "@pi67/protocol";
import { probePackageSources, unprobedPackageNetworkSnapshot } from "./package-source-probe.js";
import type { DesktopToolchain } from "./desktop-toolchain.js";

const toolchain: DesktopToolchain = {
  root: "/private/toolchain",
  ready: true,
  packaged: true,
  platform: "darwin",
  architecture: "arm64",
  nodeVersion: "24.18.0",
  npmVersion: "12.0.1",
  gitVersion: "2.53.0",
  nodeExecutable: "/private/toolchain/node/bin/node",
  npmCli: "/private/toolchain/npm/bin/npm-cli.js",
  gitExecutable: "/private/toolchain/git/bin/git"
};

describe("Package public source probes", () => {
  it("projects unprobed sources without exposing private toolchain paths", () => {
    const snapshot = unprobedPackageNetworkSnapshot(toolchain, defaultPackageNetworkSettings());
    expect(snapshot.toolchain).toMatchObject({ ready: true, nodeVersion: "24.18.0" });
    expect(snapshot.toolchain).not.toHaveProperty("root");
    expect(snapshot.sources).toHaveLength(5);
    expect(snapshot.sources.every((source) => source.status === "not-checked")).toBe(true);
  });

  it("probes npm and Git candidates independently with bounded public results", async () => {
    const snapshot = await probePackageSources({
      toolchain,
      settings: defaultPackageNetworkSettings(),
      fetcher: async (url) => new Response(JSON.stringify({ ok: true }), {
        status: String(url).includes("npmmirror") ? 200 : 503
      }),
      gitRunner: async (_executable, url) => {
        if (url.includes("ghproxy")) throw new Error("mirror unavailable\nsecret detail");
        return "91611ad87992fb7b635a41ba68f67916ff6e6ae3";
      },
      now: () => 1_700_000_000_000
    });

    expect(snapshot.checkedAt).toBe(1_700_000_000_000);
    expect(snapshot.sources.find((source) => source.id === "npm-public-mirror")?.status).toBe("reachable");
    expect(snapshot.sources.find((source) => source.id === "npm-official")?.status).toBe("unreachable");
    expect(snapshot.sources.find((source) => source.id === "git-gitclone")?.resolvedRevision)
      .toBe("91611ad87992fb7b635a41ba68f67916ff6e6ae3");
    expect(snapshot.sources.find((source) => source.id === "git-ghproxy")?.detail)
      .toBe("mirror unavailable secret detail");
  });

  it("keeps fetch failures, unavailable Git, and invalid revisions explicit", async () => {
    const unavailableToolchain: DesktopToolchain = {
      root: toolchain.root,
      ready: false,
      packaged: toolchain.packaged,
      platform: toolchain.platform,
      architecture: toolchain.architecture
    };
    const snapshot = await probePackageSources({
      toolchain: unavailableToolchain,
      settings: defaultPackageNetworkSettings(),
      fetcher: async () => {
        throw "network offline\nprivate detail";
      },
      gitRunner: async () => "not-a-revision",
      now: () => 9
    });

    expect(snapshot.checkedAt).toBe(9);
    expect(snapshot.sources.filter((source) => source.kind === "npm")).toEqual([
      expect.objectContaining({ status: "unreachable", detail: "network offline private detail" }),
      expect.objectContaining({ status: "unreachable", detail: "network offline private detail" })
    ]);
    expect(snapshot.sources.filter((source) => source.kind === "git")).toEqual([
      expect.objectContaining({ status: "not-checked", detail: "Desktop private Git is unavailable." }),
      expect.objectContaining({ status: "not-checked", detail: "Desktop private Git is unavailable." }),
      expect.objectContaining({ status: "not-checked", detail: "Desktop private Git is unavailable." })
    ]);

    const missingGitExecutable: DesktopToolchain = {
      root: toolchain.root,
      ready: true,
      packaged: toolchain.packaged,
      platform: toolchain.platform,
      architecture: toolchain.architecture
    };
    expect((await probePackageSources({
      toolchain: missingGitExecutable,
      settings: {
        npmMode: "offline",
        gitMode: "official-only",
        gitMirrors: []
      },
      fetcher: async () => new Response(null, { status: 200 })
    })).sources).toEqual([
      expect.objectContaining({ status: "not-checked", detail: "Desktop private Git is unavailable." })
    ]);

    const invalidRevision = await probePackageSources({
      toolchain,
      settings: {
        npmMode: "offline",
        gitMode: "official-only",
        gitMirrors: []
      },
      fetcher: async () => new Response(null, { status: 200 }),
      gitRunner: async () => "not-a-revision"
    });
    expect(invalidRevision.sources).toEqual([
      expect.not.objectContaining({ resolvedRevision: expect.anything() })
    ]);
  });
});
