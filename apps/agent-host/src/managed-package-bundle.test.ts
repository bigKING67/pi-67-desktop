import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activateDesktopManagedPackages,
  managedPackageTreeSha256
} from "./managed-package-bundle.js";

describe("Desktop managed npm package activation", () => {
  it("atomically activates the verified closure and injects only active package and extension paths", async () => {
    const fixture = await createFixture();
    const environment: NodeJS.ProcessEnv = {
      PI67_DESKTOP: "1",
      PI67_CAPABILITIES_ROOT: fixture.capabilitiesRoot,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([fixture.firstPartyPackage])
    };

    const first = await activateDesktopManagedPackages({
      agentDir: fixture.agentDir,
      environment,
      createToken: () => "first"
    });
    expect(first).toMatchObject({ enabled: true, activated: true });
    expect(first.packagePaths).toEqual([
      join(first.activeRoot!, "packages", "pi-mcp-adapter")
    ]);
    expect(first.extensionPaths).toEqual([
      join(first.activeRoot!, "packages", "pi-mcp-adapter", "index.ts")
    ]);
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")).toEqual([
      fixture.firstPartyPackage,
      ...first.packagePaths
    ]);
    expect(JSON.parse(environment.PI67_MANAGED_EXTENSION_PATHS ?? "[]")).toEqual(first.extensionPaths);
    expect(await readFile(join(first.activeRoot!, "node_modules", "fixture", "index.js"), "utf8"))
      .toBe("export {};\n");
    if (process.platform !== "win32") {
      expect((await stat(join(first.activeRoot!, "node_modules", "fixture", "cli"))).mode & 0o111)
        .not.toBe(0);
    }

    const second = await activateDesktopManagedPackages({
      agentDir: fixture.agentDir,
      environment,
      createToken: () => "second"
    });
    expect(second).toMatchObject({ enabled: true, activated: false });

    await writeFile(join(first.activeRoot!, "node_modules", "fixture", "index.js"), "tampered\n", "utf8");
    const repaired = await activateDesktopManagedPackages({
      agentDir: fixture.agentDir,
      environment,
      createToken: () => "repair"
    });
    expect(repaired).toMatchObject({ enabled: true, activated: true });
    expect(await readFile(join(repaired.activeRoot!, "node_modules", "fixture", "index.js"), "utf8"))
      .toBe("export {};\n");
  });

  it("drops retired managed-package state keys without changing the active adapter", async () => {
    const fixture = await createFixture();
    const environment: NodeJS.ProcessEnv = {
      PI67_DESKTOP: "1",
      PI67_CAPABILITIES_ROOT: fixture.capabilitiesRoot,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([fixture.firstPartyPackage])
    };
    const first = await activateDesktopManagedPackages({
      agentDir: fixture.agentDir,
      environment,
      createToken: () => "first"
    });
    await writeFile(join(fixture.agentDir, "desktop-capabilities", "managed-packages", "state.json"), JSON.stringify({
      schema: "pi67.managed-package-state.v1",
      enabled: {
        "pi-mcp-adapter": true,
        "pi-observational-memory": true
      }
    }), "utf8");
    environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify([fixture.firstPartyPackage]);

    const optedOut = await activateDesktopManagedPackages({
      agentDir: fixture.agentDir,
      environment,
      createToken: () => "second"
    });
    expect(optedOut.packagePaths).toEqual([
      join(first.activeRoot!, "packages", "pi-mcp-adapter")
    ]);
    expect(optedOut.extensionPaths).toEqual([
      join(first.activeRoot!, "packages", "pi-mcp-adapter", "index.ts")
    ]);
    expect(JSON.parse(await readFile(join(
      fixture.agentDir,
      "desktop-capabilities",
      "managed-packages",
      "state.json"
    ), "utf8"))).toEqual({
      schema: "pi67.managed-package-state.v1",
      enabled: { "pi-mcp-adapter": true }
    });
  });

  it("uses the packaged bundle directly without creating an active copy", async () => {
    const fixture = await createFixture();
    const environment: NodeJS.ProcessEnv = {
      PI67_DESKTOP: "1",
      PI67_PACKAGED: "1",
      PI67_CAPABILITIES_ROOT: fixture.capabilitiesRoot,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([fixture.firstPartyPackage]),
      PI67_BUNDLED_CAPABILITIES_ROOT: fixture.capabilitiesRoot,
      PI67_MANAGED_CAPABILITIES_ROOT: join(fixture.agentDir, "desktop-capabilities")
    };

    const result = await activateDesktopManagedPackages({
      agentDir: fixture.agentDir,
      environment
    });

    expect(result).toMatchObject({ enabled: true, activated: false, projectionMode: "packaged-direct" });
    expect(result.activeRoot).toBe(join(fixture.capabilitiesRoot, "managed-packages", "bundled"));
    await expect(stat(join(
      fixture.agentDir,
      "desktop-capabilities",
      "managed-packages",
      "active"
    ))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-managed-packages-"));
  const capabilitiesRoot = join(root, "capabilities");
  const bundled = join(capabilitiesRoot, "managed-packages", "bundled");
  const agentDir = join(root, "agent");
  const firstPartyPackage = join(agentDir, "desktop-capabilities", "packages", "pi-workspace-resources");
  await Promise.all([
    mkdir(join(bundled, "packages", "pi-mcp-adapter"), { recursive: true }),
    mkdir(join(bundled, "node_modules", "fixture"), { recursive: true }),
    mkdir(firstPartyPackage, { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(bundled, "package-lock.json"), "{}\n", "utf8"),
    writeFile(join(bundled, "package.json"), "{}\n", "utf8"),
    writeFile(join(bundled, "packages", "pi-mcp-adapter", "package.json"), "{\"name\":\"pi-mcp-adapter\"}\n", "utf8"),
    writeFile(join(bundled, "packages", "pi-mcp-adapter", "index.ts"), "export default () => {};\n", "utf8"),
    writeFile(join(bundled, "node_modules", "fixture", "index.js"), "export {};\n", "utf8"),
    writeFile(join(bundled, "node_modules", "fixture", "cli"), "#!/usr/bin/env node\n", "utf8")
  ]);
  await chmod(join(bundled, "node_modules", "fixture", "cli"), 0o755);
  const tree = await managedPackageTreeSha256(bundled);
  const lockfile = await readFile(join(bundled, "package-lock.json"));
  const { createHash } = await import("node:crypto");
  await writeFile(join(bundled, "manifest.json"), JSON.stringify({
    schema: "pi67.managed-npm-bundle.v1",
    catalogVersion: "test.1",
    platform: process.platform,
    architecture: process.arch,
    lockfileSha256: createHash("sha256").update(lockfile).digest("hex"),
    treeSha256: tree.sha256,
    fileCount: tree.fileCount,
    totalBytes: tree.totalBytes,
    packages: [{
      id: "pi-mcp-adapter",
      packageName: "pi-mcp-adapter",
      source: "npm:pi-mcp-adapter",
      version: "2.11.0",
      packageIntegrity: `sha512-${"A".repeat(86)}==`,
      packagePath: "packages/pi-mcp-adapter",
      extensionPaths: ["index.ts"],
      defaultEnabled: true
    }]
  }), "utf8");
  return { capabilitiesRoot, agentDir, firstPartyPackage };
}
