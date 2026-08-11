import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
      join(first.activeRoot!, "packages", "pi-mcp-adapter"),
      join(first.activeRoot!, "packages", "pi-observational-memory")
    ]);
    expect(first.extensionPaths).toEqual([
      join(first.activeRoot!, "packages", "pi-mcp-adapter", "index.ts"),
      join(first.activeRoot!, "packages", "pi-observational-memory", "src", "index.ts")
    ]);
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")).toEqual([
      fixture.firstPartyPackage,
      ...first.packagePaths
    ]);
    expect(JSON.parse(environment.PI67_MANAGED_EXTENSION_PATHS ?? "[]")).toEqual(first.extensionPaths);
    expect(await readFile(join(first.activeRoot!, "node_modules", "fixture", "index.js"), "utf8"))
      .toBe("export {};\n");

    const second = await activateDesktopManagedPackages({
      agentDir: fixture.agentDir,
      environment,
      createToken: () => "second"
    });
    expect(second).toMatchObject({ enabled: true, activated: false });
  });

  it("preserves the Desktop-owned observational-memory opt-out without changing the adapter", async () => {
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
        "pi-observational-memory": false
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
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-managed-packages-"));
  const capabilitiesRoot = join(root, "capabilities");
  const bundled = join(capabilitiesRoot, "managed-packages", "bundled");
  const agentDir = join(root, "agent");
  const firstPartyPackage = join(agentDir, "desktop-capabilities", "packages", "pi67-core");
  await Promise.all([
    mkdir(join(bundled, "packages", "pi-mcp-adapter"), { recursive: true }),
    mkdir(join(bundled, "packages", "pi-observational-memory", "src"), { recursive: true }),
    mkdir(join(bundled, "node_modules", "fixture"), { recursive: true }),
    mkdir(firstPartyPackage, { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(bundled, "package-lock.json"), "{}\n", "utf8"),
    writeFile(join(bundled, "package.json"), "{}\n", "utf8"),
    writeFile(join(bundled, "packages", "pi-mcp-adapter", "index.ts"), "export default () => {};\n", "utf8"),
    writeFile(
      join(bundled, "packages", "pi-observational-memory", "src", "index.ts"),
      "export default () => {};\n",
      "utf8"
    ),
    writeFile(join(bundled, "node_modules", "fixture", "index.js"), "export {};\n", "utf8")
  ]);
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
    }, {
      id: "pi-observational-memory",
      packageName: "pi-observational-memory",
      source: "npm:pi-observational-memory",
      version: "3.0.3",
      packageIntegrity: `sha512-${"B".repeat(86)}==`,
      packagePath: "packages/pi-observational-memory",
      extensionPaths: ["src/index.ts"],
      defaultEnabled: true
    }]
  }), "utf8");
  return { capabilitiesRoot, agentDir, firstPartyPackage };
}
