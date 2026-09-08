import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as integrity from "./desktop-capability-file-integrity.js";
import { activateSharedProfile } from "./desktop-shared-profile.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-shared-integrity-"));
  roots.push(root);
  const source = join(root, "source");
  const agentDir = join(root, "agent");
  await mkdir(source);
  await mkdir(agentDir);
  await writeFile(join(source, "package.json"), "{}\n");
  const treeSha256 = await integrity.capabilityTreeSha256(source);
  return {
    agentDir,
    managedRoot: join(agentDir, "desktop-capabilities"),
    catalogVersion: "test.1",
    packages: [{ id: "fixture", displayName: "Fixture", source,
      packagePath: "packages/fixture", treeSha256, includeNodeModules: false }],
    createToken: () => "fixture"
  };
}

describe("shared profile activation integrity", () => {
  it("verifies each staged tree once and still verifies active content on reuse", async () => {
    const options = await fixture();
    const hashes = vi.spyOn(integrity, "capabilityTreeSha256");
    const installed = await activateSharedProfile(options);
    expect(installed.status).toBe("installed");
    expect(hashes).toHaveBeenCalledTimes(1);
    hashes.mockClear();
    expect((await activateSharedProfile(options)).status).toBe("current");
    expect(hashes).toHaveBeenCalledTimes(1);
    await writeFile(join(installed.root, "packages/fixture/package.json"), "tampered\n");
    await expect(activateSharedProfile(options)).rejects.toThrow("failed integrity verification");
  });

  it("rejects corrupt staged content before activation and cleans its staging directory", async () => {
    const options = await fixture();
    await writeFile(join(options.packages[0]!.source, "package.json"), "changed after manifest\n");
    await expect(activateSharedProfile(options)).rejects.toThrow("staging receipt failed verification");
    const root = join(options.managedRoot, "shared-profile");
    expect(await readdir(join(root, "staging"))).toEqual([]);
    await expect(readFile(join(root, "active/receipt.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(options.agentDir, "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the active profile and settings when an upgrade fails integrity", async () => {
    const options = await fixture();
    const installed = await activateSharedProfile(options);
    const settings = await readFile(join(options.agentDir, "settings.json"), "utf8");
    const receipt = await readFile(installed.receiptPath, "utf8");
    options.catalogVersion = "test.2";
    await writeFile(join(options.packages[0]!.source, "package.json"), "corrupt upgrade\n");
    await expect(activateSharedProfile(options)).rejects.toThrow("staging receipt failed verification");
    expect(await readFile(installed.receiptPath, "utf8")).toBe(receipt);
    expect(await readFile(join(installed.root, "packages/fixture/package.json"), "utf8")).toBe("{}\n");
    expect(await readFile(join(options.agentDir, "settings.json"), "utf8")).toBe(settings);
    expect(await readdir(join(options.managedRoot, "shared-profile/staging"))).toEqual([]);
  });
});
