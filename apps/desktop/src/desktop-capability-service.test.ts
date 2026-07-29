import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DesktopCapabilityService } from "./desktop-capability-service.js";
import { PackageNetworkSettingsStore } from "./package-network-settings.js";

describe("Desktop capability service", () => {
  it("reports bundled capability and browser67 setup states without exposing paths", async () => {
    const fixture = await createFixture();
    const runNpm = vi.fn(async (_registry: string, cwd: string) => {
      await mkdir(join(cwd, "node_modules", "ajv"), { recursive: true });
      await mkdir(join(cwd, "node_modules", "ws"), { recursive: true });
      await writeFile(join(cwd, "node_modules", "ajv", "package.json"), "{}", "utf8");
      await writeFile(join(cwd, "node_modules", "ws", "package.json"), "{}", "utf8");
    });
    const service = new DesktopCapabilityService({
      ...fixture,
      runNpm,
      runBrowserDoctor: vi.fn(async () => undefined),
      now: () => 123,
      createToken: () => "fixture"
    });

    expect(await service.snapshot()).toMatchObject({
      phase: "ready",
      packages: [{ id: "browser67", installed: true }],
      integrations: [{ dependencyState: "not-prepared", doctorState: "not-checked" }]
    });
    const prepared = await service.setupBrowser67();
    expect(runNpm).toHaveBeenCalledWith("https://registry.npmmirror.com", expect.any(String), fixture.toolchain);
    expect(prepared.integrations[0]).toMatchObject({
      dependencyState: "prepared",
      doctorState: "degraded",
      preparedAt: 123,
      registry: "https://registry.npmmirror.com"
    });
    expect(JSON.stringify(prepared)).not.toContain(fixture.agentDir);
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-capability-service-"));
  const capabilitiesRoot = join(root, "bundled");
  const agentDir = join(root, "agent");
  const packageRoot = join(agentDir, "desktop-capabilities", "packages", "browser67");
  await mkdir(join(capabilitiesRoot), { recursive: true });
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), "{}", "utf8");
  await writeFile(join(packageRoot, "bin", "browser67.mjs"), "", "utf8");
  await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
    schema: "pi67.capability-catalog.v1",
    catalogVersion: "test.1",
    entries: [{
      id: "browser67",
      displayName: "browser67",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.4.0",
      commit: "1".repeat(40),
      packagePath: "packages/browser67",
      resourceTypes: ["skill", "integration"]
    }],
    recommendedExternal: [{ id: "pi-subagents", source: "npm:pi-subagents", recommendedVersion: "0.34.0" }]
  }), "utf8");
  await writeFile(join(agentDir, "desktop-capabilities", "state.json"), JSON.stringify({
    schema: "pi67.desktop-capability-state.v1",
    catalogVersion: "test.1",
    packages: [{ id: "browser67", installed: true }],
    rules: "installed",
    agents: "user-owned"
  }), "utf8");
  const packageNetworkSettings = new PackageNetworkSettingsStore(join(root, "user-data"));
  const toolchain = {
    root: join(root, "toolchain"),
    ready: true,
    packaged: true,
    platform: "darwin" as const,
    architecture: "arm64" as const,
    nodeVersion: "24.18.0",
    npmVersion: "12.0.1",
    gitVersion: "2.53.0",
    nodeExecutable: join(root, "toolchain", "node"),
    npmCli: join(root, "toolchain", "npm-cli.js"),
    gitExecutable: join(root, "toolchain", "git")
  };
  return { capabilitiesRoot, agentDir, toolchain, packageNetworkSettings };
}
