import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

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
});
