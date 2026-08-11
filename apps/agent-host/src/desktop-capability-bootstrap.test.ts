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
    const packageRoot = join(capabilitiesRoot, "packages", "pi67-core");
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
      packages: [{ id: "pi67-core", treeSha256 }]
    }), "utf8");
    await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
      schema: "pi67.capability-catalog.v1",
      catalogVersion: "test.1",
      entries: [{
        id: "pi67-core",
        displayName: "Pi-67 Core",
        packagePath: "packages/pi67-core",
        resourceTypes: ["extension", "skill", "prompt", "rule"]
      }],
      recommendedExternal: [{
        id: "pi-observational-memory",
        source: "npm:pi-observational-memory",
        recommendedVersion: "3.0.3",
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
      createToken: () => "fixture"
    });

    expect(result).toMatchObject({ enabled: true, catalogVersion: "test.1", agents: "user-owned" });
    expect(await readFile(join(agentDir, "AGENTS.md"), "utf8")).toBe("user agents\n");
    expect(await readFile(join(agentDir, "rules", "pi67-desktop", "desktop.md"), "utf8"))
      .toBe("desktop rule\n");
    expect(JSON.parse(environment.PI67_CAPABILITY_PACKAGE_PATHS ?? "[]")).toEqual(result.packagePaths);
    expect(environment.PI67_MANAGED_CAPABILITIES_ROOT).toBe(result.managedRoot);
    expect(JSON.parse(environment.PI67_KNOWN_PACKAGE_BASELINES ?? "[]")).toEqual([{
      source: "npm:pi-observational-memory",
      packageName: "pi-observational-memory",
      packageVersion: "3.0.3",
      baselineContentSha256: "a".repeat(64)
    }]);
  });

  it("fails closed when a bundled package does not match the locked tree hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capabilities-invalid-"));
    const capabilitiesRoot = join(root, "bundled");
    const packageRoot = join(capabilitiesRoot, "packages", "pi67-core");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(capabilitiesRoot, "manifest.json"), JSON.stringify({
      schema: "pi67.desktop-capabilities.v1",
      catalogVersion: "test.1",
      packages: [{ id: "pi67-core", treeSha256: "0".repeat(64) }]
    }), "utf8");
    await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
      schema: "pi67.capability-catalog.v1",
      catalogVersion: "test.1",
      entries: [{
        id: "pi67-core",
        displayName: "Pi-67 Core",
        packagePath: "packages/pi67-core",
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
