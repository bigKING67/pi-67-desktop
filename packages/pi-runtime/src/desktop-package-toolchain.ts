import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  SettingsManager,
  type PackageSource
} from "@earendil-works/pi-coding-agent";
import { nativeCapabilityReplacement, RuntimeError } from "@pi67/domain";
import {
  applyManagedMemoryOwnerGate,
  applyMemoryOwnerExtensionGate,
  applyMemoryOwnerPackageGate,
  inspectDesktopMemoryOwners,
  type DesktopMemoryOwnerPreflight
} from "./desktop-memory-owner-preflight.js";
import {
  desktopCapabilityRoots,
  isContainedAbsolutePath,
  isSameAbsolutePath,
  isSameOrContainedAbsolutePath,
  nonEmpty,
  projectedCapabilityPackagePaths
} from "./desktop-capability-paths.js";
import type { PackageTrustRegistry } from "./package-trust-registry.js";

type ReloadableDesktopSettingsManager = Pick<
  SettingsManager,
  "applyOverrides" | "getPackages" | "reload"
>;

interface DesktopReloadHook {
  readonly original: ReloadableDesktopSettingsManager["reload"];
  readonly wrapped: ReloadableDesktopSettingsManager["reload"];
  references: number;
}

const desktopReloadHooks = new WeakMap<object, DesktopReloadHook>();

const DESKTOP_WORKSPACE_LEGACY_EXTENSION_EXCLUSIONS = [
  "-extensions/pi-rules-loader/index.ts"
] as const;

const DESKTOP_OPENVIKING_PROJECTION_EXCLUSION = "-extensions/pi67-openviking/index.ts";

const DESKTOP_MANAGED_NPM_SOURCES = new Set([
  "npm:pi-mcp-adapter"
]);

export interface DesktopPackageToolchain {
  readonly desktop: boolean;
  readonly packaged: boolean;
  readonly root?: string;
  readonly nodeExecutable?: string;
  readonly npmCli?: string;
  readonly gitExecutable?: string;
  readonly gitExecPath?: string;
  readonly networkSettingsPath?: string;
  readonly electronExecutable?: string;
  readonly ready: boolean;
}

export function resolveDesktopPackageToolchain(
  environment: NodeJS.ProcessEnv = process.env
): DesktopPackageToolchain {
  const desktop = environment.PI67_DESKTOP === "1";
  const packaged = environment.PI67_PACKAGED === "1";
  const root = nonEmpty(environment.PI67_TOOLCHAIN_ROOT);
  const nodeExecutable = nonEmpty(environment.PI67_NODE_EXECUTABLE);
  const npmCli = nonEmpty(environment.PI67_NPM_CLI);
  const gitExecutable = nonEmpty(environment.PI67_GIT_EXECUTABLE);
  const gitExecPath = nonEmpty(environment.PI67_GIT_EXEC_PATH);
  const networkSettingsPath = nonEmpty(environment.PI67_PACKAGE_NETWORK_SETTINGS);
  const electronExecutable = nonEmpty(environment.PI67_ELECTRON_EXECUTABLE);
  return {
    desktop,
    packaged,
    ...(root === undefined ? {} : { root }),
    ...(nodeExecutable === undefined ? {} : { nodeExecutable }),
    ...(npmCli === undefined ? {} : { npmCli }),
    ...(gitExecutable === undefined ? {} : { gitExecutable }),
    ...(gitExecPath === undefined ? {} : { gitExecPath }),
    ...(networkSettingsPath === undefined ? {} : { networkSettingsPath }),
    ...(electronExecutable === undefined ? {} : { electronExecutable }),
    ready: !desktop || (
      root !== undefined
      && nodeExecutable !== undefined
      && npmCli !== undefined
      && gitExecutable !== undefined
      && gitExecPath !== undefined
      && isContainedAbsolutePath(nodeExecutable, root)
      && isContainedAbsolutePath(npmCli, root)
      && isContainedAbsolutePath(gitExecutable, root)
      && isContainedAbsolutePath(gitExecPath, root)
    )
  };
}

export function applyDesktopPackageToolchain(
  settingsManager: Pick<SettingsManager, "applyOverrides" | "getPackages">,
  environment: NodeJS.ProcessEnv = process.env
): DesktopPackageToolchain {
  const toolchain = resolveDesktopPackageToolchain(environment);
  if (!toolchain.desktop) return toolchain;
  if (!toolchain.ready || !toolchain.nodeExecutable || !toolchain.npmCli) {
    throw new RuntimeError(
      "TOOLCHAIN_MISSING",
      "Pi-67 Desktop private Node/npm/Git toolchain is unavailable.",
      { recoverable: false, details: { packaged: toolchain.packaged } }
    );
  }
  const packages = withoutManagedNpmPackageSources(withoutNativeReplacedPackages(
    desktopCapabilityPackages(settingsManager.getPackages(), environment)
  ), environment);
  settingsManager.applyOverrides({
    npmCommand: [toolchain.nodeExecutable, toolchain.npmCli],
    ...(packages.length === 0 ? {} : { packages })
  });
  return toolchain;
}

export async function reloadDesktopSettings(
  settingsManager: ReloadableDesktopSettingsManager,
  environment: NodeJS.ProcessEnv = process.env
): Promise<DesktopPackageToolchain> {
  await settingsManager.reload();
  return applyDesktopPackageToolchain(settingsManager, environment);
}

export function installDesktopPackageToolchainReloadHook(
  settingsManager: ReloadableDesktopSettingsManager,
  environment: NodeJS.ProcessEnv = process.env
): () => void {
  const toolchain = applyDesktopPackageToolchain(settingsManager, environment);
  if (!toolchain.desktop) return () => undefined;

  const existing = desktopReloadHooks.get(settingsManager);
  if (existing) {
    existing.references += 1;
    return () => releaseDesktopReloadHook(settingsManager, existing);
  }

  const original = settingsManager.reload;
  const hook: DesktopReloadHook = {
    original,
    references: 1,
    wrapped: async () => {
      await original.call(settingsManager);
      applyDesktopPackageToolchain(settingsManager, environment);
    }
  };
  desktopReloadHooks.set(settingsManager, hook);
  settingsManager.reload = hook.wrapped;
  return () => releaseDesktopReloadHook(settingsManager, hook);
}

export function createDesktopPackageSettingsView(
  settingsManager: SettingsManager,
  environment: NodeJS.ProcessEnv = process.env,
  trustRegistry?: Pick<PackageTrustRegistry, "runtimePackageAllowed">,
  memoryOwnerPreflight?: DesktopMemoryOwnerPreflight
): SettingsManager {
  const desktop = resolveDesktopPackageToolchain(environment).desktop;
  if (!desktop && memoryOwnerPreflight === undefined) return settingsManager;
  return new Proxy(settingsManager, {
    get(target, property) {
      if (property === "getGlobalSettings") {
        return () => {
          const settings = target.getGlobalSettings();
          const runtimePackages = desktop
            ? withoutNativeReplacedPackages(desktopCapabilityPackages(settings.packages ?? [], environment))
            : settings.packages ?? [];
          const packages = applyMemoryOwnerPackageGate(runtimeAdmittedPackages(
            runtimePackages,
            "global",
            trustRegistry
          ), memoryOwnerPreflight);
          const extensionOverrides = desktop
            ? desktopExtensionOverrides(settings.extensions ?? [], packages, environment)
            : settings.extensions ?? [];
          return {
            ...settings,
            packages,
            extensions: applyMemoryOwnerExtensionGate(
              extensionOverrides,
              "global",
              memoryOwnerPreflight
            )
          };
        };
      }
      if (property === "getProjectSettings") {
        return () => {
          const settings = target.getProjectSettings();
          const runtimePackages = desktop
            ? withoutManagedNpmPackageSources(
                withoutNativeReplacedPackages(settings.packages ?? []),
                environment
              )
            : settings.packages ?? [];
          return {
            ...settings,
            packages: applyMemoryOwnerPackageGate(runtimeAdmittedPackages(
              runtimePackages,
              "project",
              trustRegistry
            ), memoryOwnerPreflight),
            extensions: applyMemoryOwnerExtensionGate(
              settings.extensions ?? [],
              "project",
              memoryOwnerPreflight
            )
          };
        };
      }
      if (property === "getPackages") {
        return () => applyMemoryOwnerPackageGate((desktop
          ? withoutManagedNpmPackageSources(
              withoutNativeReplacedPackages(target.getPackages()),
              environment
            )
          : target.getPackages()).filter((entry) => {
          const source = typeof entry === "string" ? entry : entry.source;
          return trustRegistry === undefined
            || trustRegistry.runtimePackageAllowed(source, "global")
            || trustRegistry.runtimePackageAllowed(source, "project");
        }), memoryOwnerPreflight);
      }
      if (property === "setPackages") {
        return (packages: PackageSource[]) => {
          target.setPackages(desktop
            ? withoutDesktopCapabilityPackages(packages, environment)
            : packages);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

export function inspectGlobalDesktopMemoryOwners(
  agentDir: string,
  environment: NodeJS.ProcessEnv = process.env
): DesktopMemoryOwnerPreflight {
  const settingsManager = SettingsManager.create(agentDir, agentDir, {
    projectTrusted: false
  });
  return inspectDesktopMemoryOwners({
    cwd: agentDir,
    agentDir,
    reservedOwner: "pi67-openviking",
    settingsManager: createDesktopPackageSettingsView(settingsManager, environment)
  });
}

function withoutNativeReplacedPackages(configured: PackageSource[]): PackageSource[] {
  return configured.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return nativeCapabilityReplacement(source) === undefined;
  });
}

function withoutManagedNpmPackageSources(
  configured: PackageSource[],
  environment: NodeJS.ProcessEnv
): PackageSource[] {
  const active = activeManagedNpmPackageIds(environment);
  if (active.size === 0) return configured;
  return configured.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    const normalized = source.trim().replace(/@(?:\^|~)?\d[^/]*$/u, "");
    return !DESKTOP_MANAGED_NPM_SOURCES.has(normalized) || !active.has(normalized.slice("npm:".length));
  });
}

export function managedDesktopExtensionPaths(
  environment: NodeJS.ProcessEnv = process.env,
  memoryOwnerPreflight?: DesktopMemoryOwnerPreflight
): string[] {
  const capabilityRoots = desktopCapabilityRoots(environment);
  const serialized = nonEmpty(environment.PI67_MANAGED_EXTENSION_PATHS);
  if (!serialized) return [];
  if (capabilityRoots.length === 0) {
    throw new RuntimeError(
      "TOOLCHAIN_INTEGRITY_FAILED",
      "Pi-67 Desktop managed Extension root is unavailable.",
      { recoverable: false }
    );
  }
  let candidates: unknown;
  try {
    candidates = JSON.parse(serialized) as unknown;
  } catch {
    throw new RuntimeError(
      "TOOLCHAIN_INTEGRITY_FAILED",
      "Pi-67 Desktop managed Extension paths are malformed.",
      { recoverable: false }
    );
  }
  if (
    !Array.isArray(candidates)
    || candidates.length > 16
    || candidates.some((path) => (
      typeof path !== "string"
      || path.length > 4_096
      || !capabilityRoots.some((root) => isContainedAbsolutePath(path, root))
    ))
  ) {
    throw new RuntimeError(
      "TOOLCHAIN_INTEGRITY_FAILED",
      "Pi-67 Desktop managed Extension paths escaped their verified root.",
      { recoverable: false }
    );
  }
  return applyManagedMemoryOwnerGate([...new Set(candidates)], memoryOwnerPreflight);
}

function runtimeAdmittedPackages(
  configured: PackageSource[],
  scope: "global" | "project",
  trustRegistry: Pick<PackageTrustRegistry, "runtimePackageAllowed"> | undefined
): PackageSource[] {
  if (!trustRegistry) return configured;
  return configured.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return trustRegistry.runtimePackageAllowed(source, scope);
  });
}

function desktopExtensionOverrides(
  configured: string[],
  packages: PackageSource[],
  environment: NodeJS.ProcessEnv
): string[] {
  const workspaceResourceRoots = projectedCapabilityPackagePaths(environment)
    .filter((root) => basename(root) === "pi-workspace-resources");
  if (workspaceResourceRoots.length === 0) return configured;
  const hasManagedWorkspaceResources = packages.some((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return workspaceResourceRoots.some((root) => isSameAbsolutePath(source, root));
  });
  if (!hasManagedWorkspaceResources) return configured;
  const exclusions = [
    ...DESKTOP_WORKSPACE_LEGACY_EXTENSION_EXCLUSIONS,
    ...(environment.PI67_OPENVIKING_SHARED_PROJECTION === "managed"
      ? [DESKTOP_OPENVIKING_PROJECTION_EXCLUSION]
      : [])
  ];
  return [...new Set([...configured, ...exclusions])];
}

function releaseDesktopReloadHook(
  settingsManager: ReloadableDesktopSettingsManager,
  hook: DesktopReloadHook
): void {
  const current = desktopReloadHooks.get(settingsManager);
  if (current !== hook) return;
  current.references -= 1;
  if (current.references > 0) return;
  desktopReloadHooks.delete(settingsManager);
  if (settingsManager.reload === hook.wrapped) settingsManager.reload = hook.original;
}

function desktopCapabilityPackages(
  configured: PackageSource[],
  environment: NodeJS.ProcessEnv
): PackageSource[] {
  const capabilityRoots = desktopCapabilityRoots(environment);
  const serialized = nonEmpty(environment.PI67_CAPABILITY_PACKAGE_PATHS);
  if (capabilityRoots.length === 0) return configured;
  const userConfigured = withoutManagedNpmPackageSources(
    withoutDesktopCapabilityPackages(configured, environment),
    environment
  );
  if (!serialized) return userConfigured;
  let candidates: unknown;
  try {
    candidates = JSON.parse(serialized) as unknown;
  } catch {
    throw new RuntimeError(
      "TOOLCHAIN_INTEGRITY_FAILED",
      "Pi-67 Desktop managed capability paths are malformed.",
      { recoverable: false }
    );
  }
  if (
    !Array.isArray(candidates)
    || candidates.length > 32
    || candidates.some((path) => (
      typeof path !== "string"
      || !capabilityRoots.some((root) => isContainedAbsolutePath(path, root))
    ))
  ) {
    throw new RuntimeError(
      "TOOLCHAIN_INTEGRITY_FAILED",
      "Pi-67 Desktop managed capability paths escaped their verified root.",
      { recoverable: false }
    );
  }
  const result = structuredClone(userConfigured);
  const configuredSources = new Set(result.map((entry) => typeof entry === "string" ? entry : entry.source));
  for (const path of candidates) {
    if (!configuredSources.has(path)) result.push(path);
  }
  return result;
}

function activeManagedNpmPackageIds(environment: NodeJS.ProcessEnv): Set<string> {
  const root = nonEmpty(environment.PI67_MANAGED_NPM_ROOT);
  const serialized = nonEmpty(environment.PI67_CAPABILITY_PACKAGE_PATHS);
  if (!root || !serialized || !isAbsolute(root)) return new Set();
  let candidates: unknown;
  try {
    candidates = JSON.parse(serialized) as unknown;
  } catch {
    return new Set();
  }
  if (!Array.isArray(candidates)) return new Set();
  const packageRoot = join(root, "packages");
  return new Set(candidates.flatMap((candidate) => {
    if (typeof candidate !== "string" || !isContainedAbsolutePath(candidate, packageRoot)) return [];
    const fromRoot = relative(resolve(packageRoot), resolve(candidate));
    return fromRoot !== "" && !fromRoot.includes(sep) ? [fromRoot] : [];
  }));
}

function withoutDesktopCapabilityPackages(
  configured: PackageSource[],
  environment: NodeJS.ProcessEnv
): PackageSource[] {
  const capabilityRoots = desktopCapabilityRoots(environment);
  if (capabilityRoots.length === 0) return configured;
  return configured.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return !capabilityRoots.some((root) => isSameOrContainedAbsolutePath(source, root));
  });
}
