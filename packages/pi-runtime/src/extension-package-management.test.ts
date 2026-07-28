import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
          installed: true
        },
        {
          source: "https://example.invalid/filtered.git",
          scope: "global",
          enabled: false,
          filtered: true,
          installed: true
        },
        {
          source: "../local-extension",
          scope: "project",
          enabled: true,
          filtered: false,
          installed: true
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
});

function servicesFixture() {
  const global: PackageSource[] = [];
  const project: PackageSource[] = [];
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
      installedPath: `/installed/global/${sourceOf(entry)}`
    })),
    ...project.map((entry) => ({
      source: sourceOf(entry),
      scope: "project" as const,
      filtered: typeof entry === "object",
      installedPath: `/installed/project/${sourceOf(entry)}`
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
    updates,
    installAndPersist,
    removeAndPersist,
    removeSourceFromSettings,
    flush,
    update
  };
}
