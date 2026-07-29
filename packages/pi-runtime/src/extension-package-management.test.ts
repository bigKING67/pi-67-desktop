import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtensionPackageManagement,
  type ExtensionPackageManagementServices
} from "./extension-package-management.js";

describe("ExtensionPackageManagement", () => {
  let fixture: ReturnType<typeof servicesFixture>;
  let management: ExtensionPackageManagement;

  beforeEach(() => {
    fixture = servicesFixture();
    management = new ExtensionPackageManagement(fixture.services);
  });

  afterEach(() => {
    delete process.env.PI67_MANAGED_CAPABILITIES_ROOT;
  });

  it("lists Pi-configured packages without exposing installation paths", () => {
    fixture.global.push("npm:global-extension", {
      source: "https://example.invalid/filtered.git",
      extensions: []
    });
    fixture.project.push("../local-extension");

    expect(management.list()).toEqual({
      items: [
        {
          source: "npm:global-extension",
          scope: "global",
          enabled: true,
          filtered: false,
          installed: true,
          sourceKind: "npm",
          origin: "external",
          resourceTypes: ["extension"],
          resourceStates: [{ type: "extension", enabled: true }]
        },
        {
          source: "https://example.invalid/filtered.git",
          scope: "global",
          enabled: false,
          filtered: true,
          installed: true,
          sourceKind: "git",
          origin: "external",
          resourceTypes: ["extension"],
          resourceStates: [{ type: "extension", enabled: false }]
        },
        {
          source: "../local-extension",
          scope: "project",
          enabled: true,
          filtered: false,
          installed: true,
          sourceKind: "path",
          origin: "external",
          resourceTypes: ["extension"],
          resourceStates: [{ type: "extension", enabled: true }]
        }
      ],
      total: 3
    });
    expect(JSON.stringify(management.list())).not.toContain("/installed/");
  });

  it("uses Pi install and uninstall APIs for project-local paths", async () => {
    await expect(management.install(" ../local-extension ", "project")).resolves.toMatchObject({
      changed: true,
      total: 1
    });
    expect(fixture.installAndPersist).toHaveBeenCalledWith("../local-extension", { local: true });
    expect(fixture.project).toEqual(["../local-extension"]);

    await expect(management.uninstall("../local-extension", "project")).resolves.toMatchObject({
      changed: true,
      total: 0
    });
    expect(fixture.removeAndPersist).toHaveBeenCalledWith("../local-extension", { local: true });
    expect(fixture.flush).toHaveBeenCalledTimes(2);
  });

  it("projects bounded local package metadata without exposing installed paths", () => {
    const root = mkdtempSync(join(tmpdir(), "pi67-extension-metadata-"));
    const packageRoot = join(root, "pi-subagents");
    const source = "npm:pi-subagents";
    try {
      mkdirSync(packageRoot);
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
        name: "pi-subagents\u0000",
        version: "0.34.0",
        description: `  Coordinates delegated\n tasks. ${"x".repeat(400)}  `,
        pi: {
          extensions: ["index.ts"],
          skills: ["skills/**"]
        }
      }));
      fixture.global.push(source);
      fixture.installedPaths.set(`global:${source}`, packageRoot);

      const result = management.list();
      expect(result.items[0]).toMatchObject({
        source,
        displayName: "pi-subagents",
        version: "0.34.0",
        resourceTypes: ["extension", "skill"]
      });
      expect(result.items[0]?.description).toHaveLength(320);
      expect(result.items[0]?.description).toMatch(/^Coordinates delegated tasks\./u);
      expect(JSON.stringify(result)).not.toContain(packageRoot);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("changes only the Extension filter and can restore project inheritance", async () => {
    fixture.global.push({
      source: "npm:shared-package",
      skills: ["skills/**"]
    });

    await management.setEnabled("npm:shared-package", "global", false);
    expect(fixture.global).toEqual([{
      source: "npm:shared-package",
      skills: ["skills/**"],
      extensions: []
    }]);

    await management.setEnabled("npm:shared-package", "project", true);
    expect(fixture.project).toEqual([{
      source: "npm:shared-package",
      autoload: false,
      extensions: ["**/*"]
    }]);

    await expect(management.restoreProjectInheritance("npm:shared-package")).resolves.toMatchObject({
      changed: true
    });
    expect(fixture.project).toEqual([]);
    expect(fixture.removeSourceFromSettings).toHaveBeenCalledWith("npm:shared-package", { local: true });
  });

  it("changes one resource filter without flattening Pi package object settings", async () => {
    fixture.global.push({
      source: "npm:mixed-package",
      extensions: ["extensions/**"],
      skills: ["skills/**"],
      prompts: ["prompts/**"],
      themes: ["themes/**"]
    });

    await management.setEnabled("npm:mixed-package", "global", false, "skill");

    expect(fixture.global).toEqual([{
      source: "npm:mixed-package",
      extensions: ["extensions/**"],
      skills: [],
      prompts: ["prompts/**"],
      themes: ["themes/**"]
    }]);
  });

  it("reports Pi update candidates and rejects an unconfigured scoped update", async () => {
    fixture.global.push("npm:updatable");
    fixture.updates.push({
      source: "npm:updatable",
      displayName: "updatable",
      type: "npm",
      scope: "user"
    });

    await expect(management.checkForUpdates()).resolves.toEqual({
      items: [{
        source: "npm:updatable",
        displayName: "updatable",
        type: "npm",
        scope: "global"
      }],
      total: 1
    });
    await management.update("npm:updatable", "global");
    expect(fixture.update).toHaveBeenCalledWith("npm:updatable");
    await expect(management.update("npm:updatable", "project"))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("allows resource filters but rejects independent update or uninstall for bundled packages", async () => {
    const managedRoot = resolve("/managed/desktop-capabilities");
    const source = resolve(managedRoot, "packages/pi67-core");
    process.env.PI67_MANAGED_CAPABILITIES_ROOT = managedRoot;
    fixture.global.push(source);

    await expect(management.setEnabled(source, "global", false, "skill")).resolves.toMatchObject({
      changed: true
    });
    await expect(management.update(source, "global")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(management.uninstall(source, "global")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

function servicesFixture() {
  const global: PackageSource[] = [];
  const project: PackageSource[] = [];
  const installedPaths = new Map<string, string>();
  const updates: Array<{
    source: string;
    displayName: string;
    type: "npm" | "git";
    scope: "user" | "project";
  }> = [];
  const sourceOf = (entry: PackageSource) => typeof entry === "string" ? entry : entry.source;
  const listConfiguredPackages = vi.fn(() => [
    ...global.map((entry) => ({
      source: sourceOf(entry),
      scope: "user" as const,
      filtered: typeof entry === "object",
      installedPath: installedPaths.get(`global:${sourceOf(entry)}`) ?? `/installed/global/${sourceOf(entry)}`
    })),
    ...project.map((entry) => ({
      source: sourceOf(entry),
      scope: "project" as const,
      filtered: typeof entry === "object",
      installedPath: installedPaths.get(`project:${sourceOf(entry)}`) ?? `/installed/project/${sourceOf(entry)}`
    }))
  ]);
  const installAndPersist = vi.fn(async (source: string, options?: { local?: boolean }) => {
    (options?.local ? project : global).push(source);
  });
  const removeAndPersist = vi.fn(async (source: string, options?: { local?: boolean }) => {
    const target = options?.local ? project : global;
    const index = target.findIndex((entry) => sourceOf(entry) === source);
    if (index === -1) return false;
    target.splice(index, 1);
    return true;
  });
  const removeSourceFromSettings = vi.fn((source: string, options?: { local?: boolean }) => {
    const target = options?.local ? project : global;
    const index = target.findIndex((entry) => sourceOf(entry) === source);
    if (index === -1) return false;
    target.splice(index, 1);
    return true;
  });
  const flush = vi.fn(async () => undefined);
  const update = vi.fn(async () => undefined);
  const services = {
    packageManager: {
      checkForAvailableUpdates: vi.fn(async () => [...updates]),
      installAndPersist,
      listConfiguredPackages,
      removeAndPersist,
      removeSourceFromSettings,
      update
    },
    settingsManager: {
      flush,
      getGlobalSettings: () => ({ packages: global }),
      getProjectSettings: () => ({ packages: project }),
      setPackages: (packages: PackageSource[]) => { global.splice(0, global.length, ...packages); },
      setProjectPackages: (packages: PackageSource[]) => { project.splice(0, project.length, ...packages); }
    }
  } satisfies ExtensionPackageManagementServices;
  return {
    services,
    global,
    project,
    installedPaths,
    updates,
    installAndPersist,
    removeAndPersist,
    removeSourceFromSettings,
    flush,
    update
  };
}
