import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertToolchainManifest,
  materializeWindowsGitHttpHelpers
} from "./prepare-toolchain.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Desktop private toolchain lock", () => {
  it("pins exactly the supported native targets and public mirror fallbacks", async () => {
    const lock = JSON.parse(await readFile(resolve(repositoryRoot, "eng/packaging/toolchain.lock.json"), "utf8"));
    expect(lock.schema).toBe("pi67.desktop-toolchain-lock.v1");
    expect(lock.node.version).toBe("24.18.0");
    expect(lock.npm.version).toBe("12.0.1");
    expect(lock.git.version).toBe("2.53.0");
    expect(lock.git.artifacts["darwin-arm64"].reportedVersion).toBe("2.53.0");
    expect(lock.git.artifacts["win32-x64"].reportedVersion).toBe("2.53.0.windows.3");
    expect(Object.keys(lock.node.artifacts).sort()).toEqual(["darwin-arm64", "win32-x64"]);
    expect(Object.keys(lock.git.artifacts).sort()).toEqual(["darwin-arm64", "win32-x64"]);
    expect(lock.node.artifacts["darwin-arm64"].urls[0]).toMatch(/^https:\/\/npmmirror\.com\//u);
    expect(lock.npm.urls[0]).toMatch(/^https:\/\/registry\.npmmirror\.com\//u);
    expect(lock.git.artifacts["darwin-arm64"].urls[0]).toMatch(/^https:\/\/ghproxy\.net\//u);
  });

  it("materializes Dugite Windows HTTP helpers in the configured Git exec path", async () => {
    const gitRoot = await mkdtemp(join(tmpdir(), "pi67-windows-git-"));
    temporaryDirectories.push(gitRoot);
    const binaryRoot = join(gitRoot, "mingw64", "bin");
    const execRoot = join(gitRoot, "mingw64", "libexec", "git-core");
    await Promise.all([mkdir(binaryRoot, { recursive: true }), mkdir(execRoot, { recursive: true })]);
    await Promise.all([
      writeFile(join(binaryRoot, "git-remote-http.exe"), "http-from-bin"),
      writeFile(join(binaryRoot, "git-remote-https.exe"), "https-from-bin"),
      writeFile(join(execRoot, "git-remote-http.exe"), "existing-http")
    ]);

    await materializeWindowsGitHttpHelpers(gitRoot);

    await expect(readFile(join(execRoot, "git-remote-http.exe"), "utf8")).resolves.toBe("existing-http");
    await expect(readFile(join(execRoot, "git-remote-https.exe"), "utf8")).resolves.toBe("https-from-bin");
  });

  it("rejects prepared toolchains that drift from the platform lock", async () => {
    const lock = JSON.parse(await readFile(resolve(repositoryRoot, "eng/packaging/toolchain.lock.json"), "utf8"));
    const nodeArtifact = lock.node.artifacts["darwin-arm64"];
    const gitArtifact = lock.git.artifacts["darwin-arm64"];
    const manifest = {
      schema: "pi67.desktop-toolchain.v1",
      platform: "darwin",
      architecture: "arm64",
      versions: {
        node: lock.node.version,
        npm: lock.npm.version,
        git: gitArtifact.reportedVersion,
        gitBundle: lock.git.bundleVersion
      },
      archives: {
        node: { fileName: nodeArtifact.fileName, sha256: nodeArtifact.sha256 },
        npm: { fileName: lock.npm.fileName, sha256: lock.npm.sha256 },
        git: { fileName: gitArtifact.fileName, sha256: gitArtifact.sha256 }
      }
    };

    expect(() => assertToolchainManifest(manifest, lock, "darwin", "arm64")).not.toThrow();
    expect(() => assertToolchainManifest({
      ...manifest,
      archives: { ...manifest.archives, node: { ...manifest.archives.node, sha256: "0".repeat(64) } }
    }, lock, "darwin", "arm64")).toThrow(/does not match darwin-arm64/u);
  });
});
