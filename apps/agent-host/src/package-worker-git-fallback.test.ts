import { describe, expect, it, vi } from "vitest";
import {
  checkGitPackageUpdatesWithFallback,
  GitPackageSourcesUnavailableError,
  isPinnedGitPackageSource,
  selectGitSourceWithFallback
} from "./package-worker-git-fallback.js";

describe("Package Worker Git source fallback", () => {
  it("selects a reachable source by probing the actual installed Git origin", async () => {
    const rewrites: Array<string | undefined> = [];
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error("fatal: unable to access repository: HTTP 502"))
      .mockResolvedValueOnce(undefined);

    await expect(selectGitSourceWithFallback({
      settings: { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone"] },
      packages: [{ source: "git:https://github.com/example/extension.git", installedPath: "/installed/extension" }],
      configureRewrite: (value) => rewrites.push(value),
      probe
    })).resolves.toEqual({ attempts: 2 });
    expect(rewrites).toEqual(["https://gitclone.com/github.com/", undefined]);
    expect(probe).toHaveBeenNthCalledWith(1, "/installed/extension");
    expect(probe).toHaveBeenNthCalledWith(2, "/installed/extension");
  });

  it("requires one candidate to reach every installed Git origin", async () => {
    const rewrites: Array<string | undefined> = [];
    const probe = vi.fn(async (installedPath: string) => {
      if (rewrites.at(-1)?.includes("gitclone") && installedPath.endsWith("two")) {
        throw new Error("HTTP 502");
      }
    });

    await expect(selectGitSourceWithFallback({
      settings: { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone"] },
      packages: [
        { source: "git:https://github.com/example/one.git", installedPath: "/installed/one" },
        { source: "git:https://github.com/example/two.git", installedPath: "/installed/two" }
      ],
      configureRewrite: (value) => rewrites.push(value),
      probe
    })).resolves.toEqual({ attempts: 2 });
    expect(probe.mock.calls.map(([path]) => path)).toEqual([
      "/installed/one",
      "/installed/two",
      "/installed/one",
      "/installed/two"
    ]);
  });

  it("performs zero requests in offline mode", async () => {
    const probe = vi.fn();

    await expect(selectGitSourceWithFallback({
      settings: { npmMode: "offline", gitMode: "offline", gitMirrors: [] },
      packages: [{ source: "git:https://github.com/example/extension.git", installedPath: "/installed/extension" }],
      configureRewrite: () => undefined,
      probe
    })).rejects.toBeInstanceOf(GitPackageSourcesUnavailableError);
    expect(probe).not.toHaveBeenCalled();
  });

  it("does not reinterpret an npm or comparison failure as a Git transport failure", async () => {
    const rewrites: Array<string | undefined> = [];
    const check = vi.fn().mockRejectedValue(new Error("npm view failed with response 503"));

    await expect(checkGitPackageUpdatesWithFallback({
      settings: { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone"] },
      packages: [{ source: "git:https://github.com/example/extension.git", installedPath: "/installed/extension" }],
      configureRewrite: (value) => rewrites.push(value),
      probe: async () => undefined,
      check
    })).rejects.toThrow("npm view failed with response 503");
    expect(rewrites).toEqual(["https://gitclone.com/github.com/"]);
    expect(check).toHaveBeenCalledOnce();
  });

  it("skips missing and pinned Git installs because Pi will not query them", async () => {
    const probe = vi.fn();
    const configureRewrite = vi.fn();

    await expect(selectGitSourceWithFallback({
      settings: { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone"] },
      packages: [
        { source: "git:https://github.com/example/missing.git" },
        { source: "git:https://github.com/example/pinned.git@main", installedPath: "/installed/pinned" }
      ],
      configureRewrite,
      probe
    })).resolves.toEqual({ attempts: 0 });
    expect(configureRewrite).toHaveBeenCalledWith(undefined);
    expect(probe).not.toHaveBeenCalled();
    expect(isPinnedGitPackageSource("git:https://github.com/example/pinned.git#main")).toBe(true);
    expect(isPinnedGitPackageSource("git@github.com:example/pinned.git@main")).toBe(true);
    expect(isPinnedGitPackageSource("git:https://github.com/example/current.git")).toBe(false);
  });
});
