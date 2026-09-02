import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyManagedMemoryOwnerGate,
  applyMemoryOwnerExtensionGate,
  applyMemoryOwnerPackageGate,
  inspectDesktopMemoryOwners
} from "./desktop-memory-owner-preflight.js";
import { readDesktopMemoryOwnerLoadReceipt } from "./desktop-memory-owner-load-receipt.js";
import { createDesktopSessionServices } from "./session-services.js";

const temporaryDirectories: string[] = [];
const originalDesktop = process.env.PI67_DESKTOP;

afterEach(async () => {
  if (originalDesktop === undefined) delete process.env.PI67_DESKTOP;
  else process.env.PI67_DESKTOP = originalDesktop;
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("Desktop Memory owner preflight", () => {
  it("normalizes the Desktop-internal OpenViking package to the canonical owner identity", () => {
    const settingsManager = SettingsManager.inMemory({
      packages: ["/agent/desktop-capabilities/packages/openviking-pi-extension"]
    });
    const preflight = inspectDesktopMemoryOwners({
      cwd: "/workspace",
      agentDir: "/agent",
      settingsManager
    });

    expect(preflight).toMatchObject({
      state: "single-owner",
      selectedOwner: "pi67-openviking"
    });
  });

  it("selects one enabled OpenViking owner without changing persisted settings", async () => {
    const fixture = await memoryFixture(["pi67-openviking"]);
    const settingsManager = SettingsManager.inMemory({
      extensions: ["extensions/user-tool/index.ts"]
    });

    const preflight = inspectDesktopMemoryOwners({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      settingsManager
    });

    expect(preflight).toMatchObject({
      state: "single-owner",
      selectedOwner: "pi67-openviking",
      blockedOwners: []
    });
    expect(settingsManager.getGlobalSettings().extensions).toEqual([
      "extensions/user-tool/index.ts"
    ]);
  });

  it("does not treat an explicitly disabled legacy owner as active", async () => {
    const fixture = await memoryFixture(["pi67-openviking", "pi-hy-memory"]);
    const settingsManager = SettingsManager.inMemory({
      extensions: ["-extensions/pi-hy-memory/index.ts"]
    });

    const preflight = inspectDesktopMemoryOwners({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      settingsManager
    });

    expect(preflight.state).toBe("single-owner");
    expect(preflight.candidates.map((candidate) => candidate.displayName))
      .toEqual(["pi67-openviking"]);
  });

  it("excludes a retired Memory Package while keeping the sole OpenViking owner eligible", async () => {
    const fixture = await memoryFixture(["pi67-openviking"]);
    const configuredPackages = [
      "npm:pi-observational-memory@3.0.3",
      "npm:unrelated"
    ];
    const settingsManager = SettingsManager.inMemory({ packages: configuredPackages });
    const preflight = inspectDesktopMemoryOwners({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      settingsManager
    });

    expect(preflight).toMatchObject({
      state: "single-owner",
      selectedOwner: "pi67-openviking",
      retiredOwners: ["pi-observational-memory"],
      blockedOwners: ["pi-observational-memory"]
    });
    expect(applyMemoryOwnerPackageGate(configuredPackages, preflight)).toEqual([
      { source: "npm:pi-observational-memory@3.0.3", extensions: [] },
      "npm:unrelated"
    ]);
    expect(applyMemoryOwnerExtensionGate([], "global", preflight)).toEqual([]);
    expect(settingsManager.getGlobalSettings().packages).toEqual(configuredPackages);
  });

  it("blocks two managed OpenViking instances before either path can execute", () => {
    const managed = [
      "/verified/a/pi67-openviking/index.ts",
      "/verified/b/openviking-pi/index.js",
      "/verified/normal/index.ts"
    ];
    const preflight = inspectDesktopMemoryOwners({
      cwd: "/workspace",
      agentDir: "/agent",
      managedExtensionPaths: managed
    });

    expect(preflight.state).toBe("conflict");
    expect(applyManagedMemoryOwnerGate(managed, preflight)).toEqual([
      "/verified/normal/index.ts"
    ]);
  });

  it("loads the sole OpenViking owner and excludes a retired Hy-Memory runtime", async () => {
    process.env.PI67_DESKTOP = "1";
    const fixture = await memoryFixture([
      "pi67-openviking",
      "pi-hy-memory"
    ], true);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true, keepRecentTokens: 12_000 }
    });
    const services = await createDesktopSessionServices({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      settingsManager,
      runtimeApiKeys: new Map(),
      getSafety: () => ({
        cwd: fixture.cwd,
        trust: "trusted",
        approvalMode: "guided",
        taskToolMode: "ask"
      }),
      requestApproval: async () => ({ status: "denied" })
    });
    const loaded = services.resourceLoader.getExtensions();
    const paths = loaded.extensions.map((extension) => extension.resolvedPath);

    expect(paths).toContain(join(fixture.agentDir, "extensions", "normal.ts"));
    expect(paths).toContain(join(
      fixture.agentDir,
      "extensions",
      "pi67-openviking",
      "index.ts"
    ));
    expect(paths).not.toContain(join(
      fixture.agentDir,
      "extensions",
      "pi-hy-memory",
      "index.ts"
    ));
    expect(loaded.errors).toEqual([]);
    expect(services.settingsManager.getGlobalSettings().compaction).toEqual({
      enabled: true,
      keepRecentTokens: 12_000
    });
    expect(readDesktopMemoryOwnerLoadReceipt(fixture.agentDir)).toMatchObject({
      preflightState: "single-owner",
      startupCandidates: ["pi-hy-memory", "pi67-openviking"],
      loadedOwners: ["pi67-openviking"],
      blockedOwners: ["pi-hy-memory"],
      observedAt: expect.any(Number)
    });
    expect(settingsManager.getGlobalSettings().extensions).toBeUndefined();
  }, 15_000);
});

async function memoryFixture(
  ownerDirectories: string[],
  includeNormal = false
): Promise<{ root: string; cwd: string; agentDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi67-memory-owner-"));
  temporaryDirectories.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const extensions = join(agentDir, "extensions");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    ...ownerDirectories.map((owner) => mkdir(join(extensions, owner), { recursive: true }))
  ]);
  await Promise.all(ownerDirectories.map((owner) => writeFile(
    join(extensions, owner, "index.ts"),
    "export default function memoryOwner() {}\n",
    "utf8"
  )));
  if (includeNormal) {
    await writeFile(
      join(extensions, "normal.ts"),
      "export default function normalExtension() {}\n",
      "utf8"
    );
  }
  return { root, cwd, agentDir };
}
