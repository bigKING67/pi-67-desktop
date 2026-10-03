import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, type SourceInfo } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { ConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ConfiguredCapabilityCatalog", () => {
  it("recognizes effective configured and Desktop-managed Package sources without exposing raw sources", async () => {
    const root = await temporaryDirectory();
    const managedRoot = join(root, "managed");
    const managedPackage = join(managedRoot, "packages", "pi-workspace-resources");
    await mkdir(managedPackage, { recursive: true });
    const settingsManager = SettingsManager.inMemory({
      packages: ["pi-subagents", managedPackage]
    });
    const catalog = new ConfiguredCapabilityCatalog({
      agentDir: root,
      settingsManager,
      environment: { PI67_MANAGED_CAPABILITIES_ROOT: managedRoot }
    });
    await catalog.refresh();

    expect(catalog.resolvePackageSource(packageSource("npm:pi-subagents"))).toEqual({
      kind: "configured-package",
      sourceLabel: "已配置 Package · pi-subagents"
    });
    expect(catalog.resolvePackageSource(packageSource(managedPackage))).toEqual({
      kind: "managed-package",
      sourceLabel: "桌面托管 Package · pi-workspace-resources"
    });
    expect(catalog.resolvePackageSource(packageSource("npm:not-configured"))).toEqual({
      kind: "unconfigured",
      sourceLabel: "未配置的 Package"
    });
  });

  it("fails ambiguous Package identities closed", async () => {
    const root = await temporaryDirectory();
    const settingsManager = SettingsManager.inMemory({
      packages: ["pi-example", "npm:pi-example@1.0.0"]
    });
    const catalog = new ConfiguredCapabilityCatalog({ agentDir: root, settingsManager });
    await catalog.refresh();

    expect(catalog.resolvePackageSource(packageSource("npm:pi-example"))).toEqual({
      kind: "ambiguous",
      sourceLabel: "多个已配置 Package 来源"
    });
  });


});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-configured-capabilities-"));
  temporaryDirectories.push(root);
  return root;
}

function packageSource(source: string): SourceInfo {
  return { path: source, source, scope: "user", origin: "package" };
}
