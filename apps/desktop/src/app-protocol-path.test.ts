import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveApplicationAssetFilePath,
  resolveApplicationAssetPath
} from "./app-protocol-path.js";

describe("application protocol asset paths", () => {
  const rendererDirectory = resolve("root", "renderer");

  it("maps the application root and nested assets into the renderer directory", () => {
    expect(resolveApplicationAssetPath(rendererDirectory, "app://pi67/"))
      .toBe(join(rendererDirectory, "index.html"));
    expect(resolveApplicationAssetPath(rendererDirectory, "app://pi67/assets/app.js"))
      .toBe(join(rendererDirectory, "assets/app.js"));
  });

  it.each([
    "https://pi67/index.html",
    "app://other/index.html",
    "app://PI67/index.html",
    "app://user@pi67/index.html",
    "app://user:password@pi67/index.html",
    "app://pi67:42/index.html",
    "app://pi67/index.html?debug=1",
    "app://pi67/index.html#fragment"
  ])("rejects invalid origin metadata: %s", (url) => {
    expect(resolveApplicationAssetPath(rendererDirectory, url)).toBeUndefined();
  });

  it.each([
    "app://pi67/../secret.txt",
    "app://pi67/./index.html",
    "app://pi67/%2e%2e/secret.txt",
    "app://pi67/%2e%2e%2fsecret.txt",
    "app://pi67/assets%2fsecret.txt",
    "app://pi67/assets%5csecret.txt",
    "app://pi67/%252e%252e/secret.txt",
    "app://pi67//server/share/file.txt",
    "app://pi67/C:/Windows/file.txt",
    "app://pi67/file.txt:stream",
    "app://pi67/%00index.html",
    "app://pi67/%1findex.html",
    "app://pi67/%",
    "app://pi67/assets\\app.js",
    "not a URL"
  ])("rejects malformed, traversal, separator, drive, ADS, and control paths: %s", (url) => {
    expect(resolveApplicationAssetPath(rendererDirectory, url)).toBeUndefined();
  });

  it("serves only regular files that remain inside the physical renderer root", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-app-protocol-"));
    const physicalRenderer = join(temporaryRoot, "renderer");
    const outsideDirectory = join(temporaryRoot, "outside");
    try {
      await Promise.all([
        mkdir(join(physicalRenderer, "assets"), { recursive: true }),
        mkdir(outsideDirectory)
      ]);
      await Promise.all([
        writeFile(join(physicalRenderer, "index.html"), "safe", "utf8"),
        writeFile(join(outsideDirectory, "secret.js"), "secret", "utf8")
      ]);
      await symlink(
        outsideDirectory,
        join(physicalRenderer, "assets", "linked"),
        process.platform === "win32" ? "junction" : "dir"
      );

      await expect(resolveApplicationAssetFilePath(physicalRenderer, "app://pi67/index.html"))
        .resolves.toBe(await realPhysicalPath(join(physicalRenderer, "index.html")));
      await expect(resolveApplicationAssetFilePath(physicalRenderer, "app://pi67/assets"))
        .resolves.toBeUndefined();
      await expect(resolveApplicationAssetFilePath(physicalRenderer, "app://pi67/missing.js"))
        .resolves.toBeUndefined();
      await expect(resolveApplicationAssetFilePath(physicalRenderer, "app://pi67/assets/linked/secret.js"))
        .resolves.toBeUndefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

async function realPhysicalPath(path: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(path);
}
