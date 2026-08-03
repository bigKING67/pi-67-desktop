import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { materializeWindowsGitHttpHelpers } from "./prepare-toolchain.mjs";

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
});
