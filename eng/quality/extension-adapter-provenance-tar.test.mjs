import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  createPaxPathRecord,
  createTarArchive,
  createTarball
} from "./extension-adapter-provenance-fixture.mjs";
import { readNpmTarballFiles } from "./extension-adapter-provenance-tar.mjs";

const LIMITS = Object.freeze({
  archiveBytes: 1024 * 1024,
  compressedBytes: 1024 * 1024,
  entries: 32,
  fileBytes: 64 * 1024
});
const PACKAGE_JSON = JSON.stringify({ name: "verified-package", version: "1.0.0" });

describe("Extension Adapter npm tarball reader", () => {
  it("reads regular files and a UTF-8 PAX path without retaining local metadata", () => {
    const tarball = createTarball([
      file("package/package.json", PACKAGE_JSON),
      { path: "PaxHeader", type: "x", data: createPaxPathRecord("package/src/中文.ts") },
      file("placeholder", "export const verified = true;"),
      file("package/src/after.ts", "export const after = true;")
    ]);

    const files = readNpmTarballFiles(tarball, LIMITS);

    expect([...files.keys()]).toEqual([
      "package/package.json",
      "package/src/中文.ts",
      "package/src/after.ts"
    ]);
  });

  it.each([
    ["path traversal", [file("package/package.json", PACKAGE_JSON), file("package/../escape.ts", "bad")], /unsafe path/u],
    ["duplicate file", [file("package/package.json", PACKAGE_JSON), file("package/package.json", PACKAGE_JSON)], /duplicate file/u],
    ["symbolic link", [file("package/package.json", PACKAGE_JSON), {
      path: "package/link.ts",
      type: "2",
      linkName: "outside.ts"
    }], /unsupported link/u]
  ])("rejects %s entries", (_label, entries, expected) => {
    expect(() => readNpmTarballFiles(createTarball(entries), LIMITS)).toThrow(expected);
  });

  it("rejects a malformed header checksum", () => {
    const archive = createTarArchive([file("package/package.json", PACKAGE_JSON)]);
    archive[0] ^= 1;

    expect(() => readNpmTarballFiles(gzipSync(archive), LIMITS)).toThrow(/invalid header checksum/u);
  });

  it("rejects malformed PAX metadata", () => {
    const tarball = createTarball([
      file("package/package.json", PACKAGE_JSON),
      { path: "PaxHeader", type: "x", data: "99 path=package/src/index.ts\n" },
      file("placeholder", "bad")
    ]);

    expect(() => readNpmTarballFiles(tarball, LIMITS)).toThrow(/malformed PAX length/u);
  });

  it("rejects a global PAX path that could alias later files", () => {
    const tarball = createTarball([
      { path: "GlobalPaxHeader", type: "g", data: createPaxPathRecord("package/package.json") },
      file("package/package.json", PACKAGE_JSON)
    ]);

    expect(() => readNpmTarballFiles(tarball, LIMITS)).toThrow(/unsupported global PAX path/u);
  });

  it("enforces compressed, archive, entry and per-file limits", () => {
    const tarball = createTarball([
      file("package/package.json", PACKAGE_JSON),
      file("package/src/a.ts", "a"),
      file("package/src/b.ts", "b")
    ]);

    expect(() => readNpmTarballFiles(tarball, { ...LIMITS, compressedBytes: 1 })).toThrow(/compressed bytes/u);
    expect(() => readNpmTarballFiles(tarball, { ...LIMITS, archiveBytes: 512 })).toThrow();
    expect(() => readNpmTarballFiles(tarball, { ...LIMITS, entries: 2 })).toThrow(/exceeds 2 entries/u);
    expect(() => readNpmTarballFiles(tarball, { ...LIMITS, fileBytes: 1 })).toThrow(/oversized size/u);
  });

  it("requires the canonical npm package manifest path", () => {
    expect(() => readNpmTarballFiles(
      createTarball([file("other/package.json", PACKAGE_JSON)]),
      LIMITS
    )).toThrow(/missing package\/package\.json/u);
  });
});

function file(path, data) {
  return { path, data, type: "0" };
}
