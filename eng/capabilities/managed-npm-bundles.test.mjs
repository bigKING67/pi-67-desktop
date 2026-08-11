import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertManagedNpmBundleLock,
  managedNpmBundleTreeSha256
} from "./managed-npm-bundles.mjs";

describe("managed npm bundle build contract", () => {
  it("requires exact pinned package identities and safe extension entrypoints", () => {
    const lock = {
      managedNpmBundles: [{
        id: "pi-mcp-adapter",
        packageName: "pi-mcp-adapter",
        source: "npm:pi-mcp-adapter",
        version: "2.11.0",
        packageIntegrity: `sha512-${"A".repeat(86)}==`,
        extensionPaths: ["index.ts"],
        defaultEnabled: true
      }]
    };
    expect(() => assertManagedNpmBundleLock(lock)).not.toThrow();
    expect(() => assertManagedNpmBundleLock({
      managedNpmBundles: [{ ...lock.managedNpmBundles[0], version: "latest" }]
    })).toThrow(/invalid/u);
    expect(() => assertManagedNpmBundleLock({
      managedNpmBundles: [{ ...lock.managedNpmBundles[0], extensionPaths: ["../escape.ts"] }]
    })).toThrow(/invalid/u);
  });

  it("includes node_modules in the deterministic closure hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-managed-npm-hash-"));
    await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
    await writeFile(join(root, "package-lock.json"), "{}\n", "utf8");
    const before = await managedNpmBundleTreeSha256(root);
    await writeFile(join(root, "node_modules", "dependency", "index.js"), "export {};\n", "utf8");
    const after = await managedNpmBundleTreeSha256(root);
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.fileCount).toBe(before.fileCount + 1);
  });
});
