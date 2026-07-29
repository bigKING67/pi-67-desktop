import { lstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PACKAGE_NETWORK_DIRECTORY,
  PACKAGE_NETWORK_FILENAME,
  PackageNetworkSettingsStore,
  parsePersistedPackageNetworkSettings
} from "./package-network-settings.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Package network settings persistence", () => {
  it("loads safe defaults and writes schema-validated settings atomically", async () => {
    const userData = await temporaryRoot();
    const store = new PackageNetworkSettingsStore(userData, { createToken: () => "token" });
    await expect(store.load()).resolves.toEqual({
      npmMode: "automatic",
      gitMode: "automatic",
      gitMirrors: ["gitclone", "ghproxy"]
    });

    const saved = await store.save({
      npmMode: "official-only",
      gitMode: "mirror-only",
      gitMirrors: ["ghproxy"]
    });
    const serialized = await readFile(store.requestedSettingsPath, "utf8");

    expect(parsePersistedPackageNetworkSettings(serialized)).toEqual(saved);
    if (process.platform !== "win32") {
      expect(lstatSync(join(userData, PACKAGE_NETWORK_DIRECTORY)).mode & 0o777).toBe(0o700);
      expect(lstatSync(store.requestedSettingsPath).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects credential-bearing URLs, unknown keys, malformed files, and symlink storage", async () => {
    const userData = await temporaryRoot();
    const store = new PackageNetworkSettingsStore(userData);
    await expect(store.save({
      npmMode: "custom",
      npmCustomRegistry: "https://user:secret@example.test",
      gitMode: "automatic",
      gitMirrors: []
    })).rejects.toThrow(/invalid/u);
    await expect(store.save({
      npmMode: "automatic",
      gitMode: "automatic",
      gitMirrors: [],
      credential: "secret"
    })).rejects.toThrow(/invalid/u);

    const directory = join(userData, PACKAGE_NETWORK_DIRECTORY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, PACKAGE_NETWORK_FILENAME), "{bad-json", "utf8");
    await expect(store.load()).rejects.toThrow(/malformed/u);
    await expect(store.reset()).resolves.toEqual({
      npmMode: "automatic",
      gitMode: "automatic",
      gitMirrors: ["gitclone", "ghproxy"]
    });
    await expect(store.load()).resolves.toMatchObject({ npmMode: "automatic" });

    const linkedUserData = await temporaryRoot();
    const outside = await temporaryRoot();
    await symlink(outside, join(linkedUserData, PACKAGE_NETWORK_DIRECTORY), process.platform === "win32" ? "junction" : "dir");
    await expect(new PackageNetworkSettingsStore(linkedUserData).load()).rejects.toThrow(/real directory/u);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-package-network-"));
  roots.push(root);
  return root;
}
