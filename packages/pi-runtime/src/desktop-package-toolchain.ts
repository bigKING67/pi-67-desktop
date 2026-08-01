import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";

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
  const packages = desktopCapabilityPackages(settingsManager.getPackages(), environment);
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
  environment: NodeJS.ProcessEnv = process.env
): SettingsManager {
  if (!resolveDesktopPackageToolchain(environment).desktop) return settingsManager;
  return new Proxy(settingsManager, {
    get(target, property) {
      if (property === "getGlobalSettings") {
        return () => {
          const settings = target.getGlobalSettings();
          return {
            ...settings,
            packages: desktopCapabilityPackages(settings.packages ?? [], environment)
          };
        };
      }
      if (property === "setPackages") {
        return (packages: PackageSource[]) => {
          target.setPackages(withoutDesktopCapabilityPackages(packages, environment));
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
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
  const managedRoot = nonEmpty(environment.PI67_MANAGED_CAPABILITIES_ROOT);
  const serialized = nonEmpty(environment.PI67_CAPABILITY_PACKAGE_PATHS);
  if (!managedRoot || !isAbsolute(managedRoot)) return configured;
  const userConfigured = withoutDesktopCapabilityPackages(configured, environment);
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
    || candidates.some((path) => typeof path !== "string" || !isContainedAbsolutePath(path, managedRoot))
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

function withoutDesktopCapabilityPackages(
  configured: PackageSource[],
  environment: NodeJS.ProcessEnv
): PackageSource[] {
  const managedRoot = nonEmpty(environment.PI67_MANAGED_CAPABILITIES_ROOT);
  if (!managedRoot || !isAbsolute(managedRoot)) return configured;
  return configured.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return !isSameOrContainedAbsolutePath(source, managedRoot);
  });
}

function isSameOrContainedAbsolutePath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  return normalize(candidate) === normalize(root) || isContainedAbsolutePath(candidate, root);
}

function isContainedAbsolutePath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
