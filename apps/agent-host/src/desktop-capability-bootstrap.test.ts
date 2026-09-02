import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bootstrapDesktopCapabilities,
  capabilityTreeSha256
} from "./desktop-capability-bootstrap.js";

describe("Desktop first-party capability bootstrap", () => {
  it("keeps integrity hashes stable when packaging elides empty directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capability-hash-"));
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    const before = await capabilityTreeSha256(root);
    await mkdir(join(root, "empty", "nested"), { recursive: true });
    await expect(capabilityTreeSha256(root)).resolves.toBe(before);
    await mkdir(join(root, "node_modules", "fixture"), { recursive: true });
    await writeFile(join(root, "node_modules", "fixture", "index.js"), "export {};\n", "utf8");
    await expect(capabilityTreeSha256(root)).resolves.toBe(before);
    await expect(capabilityTreeSha256(root, true)).resolves.not.toBe(before);
  });

  it("materializes verified packages and preserves a user-owned AGENTS.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capabilities-"));
    const capabilitiesRoot = join(root, "bundled");
    const agentDir = join(root, "agent");
    const packageRoot = join(capabilitiesRoot, "packages", "pi-workspace-resources");
    await mkdir(join(packageRoot, "rules"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), "{\"name\":\"@pi67/core\"}\n", "utf8");
    await writeFile(join(packageRoot, "AGENTS.md"), "bundled agents\n", "utf8");
    await writeFile(join(packageRoot, "rules", "desktop.md"), "desktop rule\n", "utf8");
    await writeFile(join(agentDir, "AGENTS.md"), "user agents\n", "utf8");
    const treeSha256 = await capabilityTreeSha256(packageRoot);
    await writeFile(join(capabilitiesRoot, "manifest.json"), JSON.stringify({
      schema: "pi67.desktop-capabilities.v1",
      catalogVersion: "test.1",
      packages: [{ id: "pi-workspace-resources", treeSha256 }]
    }), "utf8");
    await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
      schema: "pi67.capability-catalog.v1",
      catalogVersion: "test.1",
      entries: [{
        id: "pi-workspace-resources",
        displayName: "Pi Workspace Resources",
        packagePath: "packages/pi-workspace-resources",
        resourceTypes: ["extension", "skill", "prompt", "rule"]
      }],
      recommendedExternal: [{
        id: "example-prompt-once",
        source: "npm:example-prompt-once",
        recommendedVersion: "1.2.3",
        installPolicy: "prompt-once",
        admissionPolicy: "known-baseline-or-user-approval",
        baselineContentSha256: "a".repeat(64)
      }]
    }), "utf8");
    const environment: NodeJS.ProcessEnv = { PI67_DESKTOP: "1" };
    const result = await bootstrapDesktopCapabilities({
      capabilitiesRoot,
      agentDir,
      environment,
      profileOwnership: "shared",
      createToken: () => "fixture"
    });

    expect(result).toMatchObject({ enabled: true, catalogVersion: "test.1", agents: "user-owned" });
    expect(await readFile(join(agentDir, "AGENTS.md"), "utf8")).toBe("user agents\n");
    expect(await readFile(join(agentDir, "rules", "pi67-desktop", "desktop.md"), "utf8"))
      .toBe("desktop rule\n");
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")).toEqual(result.packagePaths);
    expect(environment.PI67_MANAGED_CAPABILITIES_ROOT).toBe(result.managedRoot);
    expect(environment.PI67_SHARED_PROFILE_ROOT).toBe(result.sharedProfile?.root);
    expect(JSON.parse(await readFile(join(agentDir, "desktop-capabilities", "state.json"), "utf8")))
      .toMatchObject({ profileOwnership: "shared" });
    expect(JSON.parse(environment.PI67_KNOWN_PACKAGE_BASELINES ?? "[]")).toEqual([{
      source: "npm:example-prompt-once",
      packageName: "example-prompt-once",
      packageVersion: "1.2.3",
      baselineContentSha256: "a".repeat(64)
    }]);
  });

  it("updates the stable shared profile atomically and retains one verified previous tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-shared-profile-update-"));
    const capabilitiesRoot = join(root, "bundled");
    const agentDir = join(root, "agent");
    const packageRoot = join(capabilitiesRoot, "packages", "design-craft");
    await mkdir(packageRoot, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), [
      "{",
      "  // user setting",
      "  \"theme\": \"dark\",",
      "  \"packages\": [\"npm:user-package\"]",
      "}",
      ""
    ].join("\n"), "utf8");

    const writeRelease = async (catalogVersion: string, content: string) => {
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({
        name: "@pi67/design-craft",
        version: catalogVersion
      }), "utf8");
      await writeFile(join(packageRoot, "DESIGN.md"), content, "utf8");
      const treeSha256 = await capabilityTreeSha256(packageRoot);
      await writeFile(join(capabilitiesRoot, "manifest.json"), JSON.stringify({
        schema: "pi67.desktop-capabilities.v1",
        catalogVersion,
        packages: [{ id: "design-craft", treeSha256 }]
      }), "utf8");
      await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
        schema: "pi67.capability-catalog.v1",
        catalogVersion,
        entries: [{
          id: "design-craft",
          displayName: "design-craft",
          packagePath: "packages/design-craft",
          resourceTypes: ["skill"]
        }],
        recommendedExternal: []
      }), "utf8");
      return treeSha256;
    };

    const firstHash = await writeRelease("test.shared.1", "first\n");
    const first = await bootstrapDesktopCapabilities({
      capabilitiesRoot,
      agentDir,
      environment: { PI67_DESKTOP: "1" },
      createToken: () => "first"
    });
    expect(first.sharedProfile?.status).toBe("installed");

    const secondHash = await writeRelease("test.shared.2", "second\n");
    const second = await bootstrapDesktopCapabilities({
      capabilitiesRoot,
      agentDir,
      environment: { PI67_DESKTOP: "1" },
      createToken: () => "second"
    });
    const sharedRoot = join(agentDir, "desktop-capabilities", "shared-profile");
    const activePackage = join(sharedRoot, "active", "packages", "design-craft");
    const previousPackage = join(sharedRoot, "previous", "packages", "design-craft");
    expect(second.sharedProfile?.status).toBe("updated");
    expect(await capabilityTreeSha256(activePackage)).toBe(secondHash);
    expect(await capabilityTreeSha256(previousPackage)).toBe(firstHash);
    expect(await readFile(join(activePackage, "DESIGN.md"), "utf8")).toBe("second\n");
    expect(await readFile(join(previousPackage, "DESIGN.md"), "utf8")).toBe("first\n");
    const settings = await readFile(join(agentDir, "settings.json"), "utf8");
    expect(settings).toContain("// user setting");
    expect(JSON.parse(settings.replace(/^\s*\/\/.*$/gmu, ""))).toMatchObject({
      theme: "dark",
      packages: ["npm:user-package", activePackage]
    });
  });

  it("atomically adopts the exact legacy OpenViking tree as the shared Pi TUI projection", async () => {
    const fixture = await createOpenVikingProjectionFixture({ legacyIsAdoptable: true });

    const result = await bootstrapDesktopCapabilities({
      capabilitiesRoot: fixture.capabilitiesRoot,
      agentDir: fixture.agentDir,
      environment: fixture.environment,
      createToken: () => "fixture"
    });

    expect(result.openVikingProjection).toEqual({
      status: "adopted-legacy",
      path: fixture.projectionRoot,
      treeSha256: fixture.sourceTreeSha256
    });
    expect(fixture.environment.PI67_OPENVIKING_SHARED_PROJECTION).toBe("managed");
    expect(await capabilityTreeSha256(fixture.projectionRoot)).toBe(fixture.sourceTreeSha256);
    expect(await readFile(join(fixture.projectionRoot, "index.ts"), "utf8")).toBe("desktop OpenViking\n");
  });

  it("preserves a modified OpenViking tree and marks the Memory owner projection as conflicting", async () => {
    const fixture = await createOpenVikingProjectionFixture({ legacyIsAdoptable: false });

    const result = await bootstrapDesktopCapabilities({
      capabilitiesRoot: fixture.capabilitiesRoot,
      agentDir: fixture.agentDir,
      environment: fixture.environment,
      createToken: () => "fixture"
    });

    expect(result.openVikingProjection).toMatchObject({
      status: "user-owned",
      path: fixture.projectionRoot
    });
    expect(fixture.environment.PI67_OPENVIKING_SHARED_PROJECTION).toBe("conflict");
    expect(await readFile(join(fixture.projectionRoot, "index.ts"), "utf8")).toBe("user modified OpenViking\n");
  });

  it("adopts only the exact known legacy Rules Loader tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-rules-loader-projection-"));
    const capabilitiesRoot = join(root, "bundled");
    const agentDir = join(root, "agent");
    const packageRoot = join(capabilitiesRoot, "packages", "pi-workspace-resources");
    const sourceRoot = join(packageRoot, "extensions", "pi-rules-loader");
    const projectionRoot = join(agentDir, "extensions", "pi-rules-loader");
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(projectionRoot, { recursive: true })
    ]);
    await writeFile(join(projectionRoot, "index.ts"), "legacy Rules Loader\n", "utf8");
    const legacyHash = await capabilityTreeSha256(projectionRoot);
    await Promise.all([
      writeFile(join(sourceRoot, "index.ts"), "Desktop Rules Loader\n", "utf8"),
      writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
        name: "@pi67/pi-workspace-resources",
        version: "1.0.0",
        desktopMigration: { legacyRulesLoaderTreeSha256: legacyHash }
      })}\n`, "utf8")
    ]);
    const packageHash = await capabilityTreeSha256(packageRoot);
    await Promise.all([
      writeFile(join(capabilitiesRoot, "manifest.json"), JSON.stringify({
        schema: "pi67.desktop-capabilities.v1",
        catalogVersion: "test.rules-loader.1",
        packages: [{ id: "pi-workspace-resources", treeSha256: packageHash }]
      }), "utf8"),
      writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
        schema: "pi67.capability-catalog.v1",
        catalogVersion: "test.rules-loader.1",
        entries: [{
          id: "pi-workspace-resources",
          displayName: "Pi Workspace Resources",
          packagePath: "packages/pi-workspace-resources",
          resourceTypes: ["extension", "rule"]
        }],
        recommendedExternal: []
      }), "utf8")
    ]);

    const adopted = await bootstrapDesktopCapabilities({
      capabilitiesRoot,
      agentDir,
      environment: { PI67_DESKTOP: "1" },
      createToken: () => "adopt"
    });
    expect(adopted.rulesLoaderProjection).toMatchObject({ status: "updated" });
    expect(await readFile(join(projectionRoot, "index.ts"), "utf8")).toBe("Desktop Rules Loader\n");

    await writeFile(join(projectionRoot, "index.ts"), "user modified Rules Loader\n", "utf8");
    const preserved = await bootstrapDesktopCapabilities({
      capabilitiesRoot,
      agentDir,
      environment: { PI67_DESKTOP: "1" },
      createToken: () => "preserve"
    });
    expect(preserved.rulesLoaderProjection).toMatchObject({ status: "user-owned" });
    expect(await readFile(join(projectionRoot, "index.ts"), "utf8")).toBe("user modified Rules Loader\n");
  });

  it("fails closed when a bundled package does not match the locked tree hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capabilities-invalid-"));
    const capabilitiesRoot = join(root, "bundled");
    const packageRoot = join(capabilitiesRoot, "packages", "pi-workspace-resources");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(capabilitiesRoot, "manifest.json"), JSON.stringify({
      schema: "pi67.desktop-capabilities.v1",
      catalogVersion: "test.1",
      packages: [{ id: "pi-workspace-resources", treeSha256: "0".repeat(64) }]
    }), "utf8");
    await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
      schema: "pi67.capability-catalog.v1",
      catalogVersion: "test.1",
      entries: [{
        id: "pi-workspace-resources",
        displayName: "Pi Workspace Resources",
        packagePath: "packages/pi-workspace-resources",
        resourceTypes: ["skill"]
      }],
      recommendedExternal: []
    }), "utf8");
    await expect(bootstrapDesktopCapabilities({
      capabilitiesRoot,
      agentDir: join(root, "agent"),
      environment: { PI67_DESKTOP: "1" }
    })).rejects.toThrow("integrity verification");
  });

  it("copies packaged capabilities into the stable shared Pi profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capabilities-packaged-direct-"));
    const capabilitiesRoot = join(root, "bundled");
    const agentDir = join(root, "agent");
    const packageRoot = join(capabilitiesRoot, "packages", "pi-workspace-resources");
    await mkdir(join(packageRoot, "rules"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), "{\"name\":\"@pi67/core\"}\n", "utf8");
    await writeFile(join(packageRoot, "rules", "desktop.md"), "desktop rule\n", "utf8");
    const treeSha256 = await capabilityTreeSha256(packageRoot);
    await writeFile(join(capabilitiesRoot, "manifest.json"), JSON.stringify({
      schema: "pi67.desktop-capabilities.v1",
      catalogVersion: "test.1",
      packages: [{ id: "pi-workspace-resources", treeSha256 }]
    }), "utf8");
    await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
      schema: "pi67.capability-catalog.v1",
      catalogVersion: "test.1",
      entries: [{
        id: "pi-workspace-resources",
        displayName: "Pi Workspace Resources",
        packagePath: "packages/pi-workspace-resources",
        resourceTypes: ["skill", "rule"]
      }],
      recommendedExternal: []
    }), "utf8");
    const environment: NodeJS.ProcessEnv = { PI67_DESKTOP: "1", PI67_PACKAGED: "1" };

    const result = await bootstrapDesktopCapabilities({ capabilitiesRoot, agentDir, environment });

    const sharedPackageRoot = join(
      agentDir,
      "desktop-capabilities",
      "shared-profile",
      "active",
      "packages",
      "pi-workspace-resources"
    );
    expect(result).toMatchObject({ enabled: true, projectionMode: "shared-profile" });
    expect(result.packagePaths).toContain(sharedPackageRoot);
    expect(await capabilityTreeSha256(sharedPackageRoot)).toBe(treeSha256);
    expect(environment.PI67_BUNDLED_CAPABILITIES_ROOT).toBe(capabilitiesRoot);
    expect(environment.PI67_MANAGED_CAPABILITIES_ROOT).toBe(join(agentDir, "desktop-capabilities"));
    expect(environment.PI67_SHARED_PROFILE_ROOT).toBe(result.sharedProfile?.root);
    expect(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"))).toMatchObject({
      packages: [{ source: sharedPackageRoot, extensions: [] }]
    });
  });

  it("allows an unprepared development checkout but keeps packaged builds fail closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capabilities-missing-"));
    await expect(bootstrapDesktopCapabilities({
      capabilitiesRoot: join(root, "missing"),
      agentDir: join(root, "agent"),
      environment: { PI67_DESKTOP: "1", PI67_PACKAGED: "0" }
    })).resolves.toMatchObject({ enabled: false });
    await expect(bootstrapDesktopCapabilities({
      capabilitiesRoot: join(root, "missing"),
      agentDir: join(root, "agent"),
      environment: { PI67_DESKTOP: "1", PI67_PACKAGED: "1" }
    })).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function createOpenVikingProjectionFixture(options: {
  legacyIsAdoptable: boolean;
}): Promise<{
  capabilitiesRoot: string;
  agentDir: string;
  projectionRoot: string;
  sourceTreeSha256: string;
  environment: NodeJS.ProcessEnv;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi67-openviking-projection-"));
  const capabilitiesRoot = join(root, "bundled");
  const agentDir = join(root, "agent");
  const sourceRoot = join(capabilitiesRoot, "packages", "openviking-pi-extension");
  const projectionRoot = join(agentDir, "extensions", "pi67-openviking");
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(projectionRoot, { recursive: true })
  ]);
  await writeFile(
    join(projectionRoot, "index.ts"),
    options.legacyIsAdoptable ? "legacy OpenViking\n" : "user modified OpenViking\n",
    "utf8"
  );
  const currentProjectionHash = await capabilityTreeSha256(projectionRoot);
  await Promise.all([
    writeFile(join(sourceRoot, "index.ts"), "desktop OpenViking\n", "utf8"),
    writeFile(join(sourceRoot, "package.json"), `${JSON.stringify({
      name: "@pi67/openviking-pi-extension",
      version: "0.2.0-desktop.1",
      pi: { extensions: ["./index.ts"] },
      pi67DesktopMigration: {
        importedTreeSha256: options.legacyIsAdoptable ? currentProjectionHash : "0".repeat(64)
      }
    })}\n`, "utf8")
  ]);
  const sourceTreeSha256 = await capabilityTreeSha256(sourceRoot);
  await Promise.all([
    writeFile(join(capabilitiesRoot, "manifest.json"), JSON.stringify({
      schema: "pi67.desktop-capabilities.v1",
      catalogVersion: "test.openviking.1",
      packages: [{ id: "openviking-pi-extension", treeSha256: sourceTreeSha256 }]
    }), "utf8"),
    writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
      schema: "pi67.capability-catalog.v1",
      catalogVersion: "test.openviking.1",
      entries: [{
        id: "openviking-pi-extension",
        displayName: "OpenViking Pi Extension",
        packagePath: "packages/openviking-pi-extension",
        resourceTypes: ["extension", "memory"]
      }],
      recommendedExternal: []
    }), "utf8")
  ]);
  return {
    capabilitiesRoot,
    agentDir,
    projectionRoot,
    sourceTreeSha256,
    environment: { PI67_DESKTOP: "1" }
  };
}
