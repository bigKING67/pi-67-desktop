import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";

export interface DesktopPackageToolchain {
  readonly desktop: boolean;
  readonly packaged: boolean;
  readonly root?: string;
  readonly nodeExecutable?: string;
  readonly npmCli?: string;
  readonly gitExecutable?: string;
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
  const networkSettingsPath = nonEmpty(environment.PI67_PACKAGE_NETWORK_SETTINGS);
  const electronExecutable = nonEmpty(environment.PI67_ELECTRON_EXECUTABLE);
  return {
    desktop,
    packaged,
    ...(root === undefined ? {} : { root }),
    ...(nodeExecutable === undefined ? {} : { nodeExecutable }),
    ...(npmCli === undefined ? {} : { npmCli }),
    ...(gitExecutable === undefined ? {} : { gitExecutable }),
    ...(networkSettingsPath === undefined ? {} : { networkSettingsPath }),
    ...(electronExecutable === undefined ? {} : { electronExecutable }),
    ready: !desktop || (
      root !== undefined
      && nodeExecutable !== undefined
      && npmCli !== undefined
      && gitExecutable !== undefined
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
  settingsManager: Pick<SettingsManager, "applyOverrides" | "getPackages" | "reload">,
  environment: NodeJS.ProcessEnv = process.env
): Promise<DesktopPackageToolchain> {
  await settingsManager.reload();
  return applyDesktopPackageToolchain(settingsManager, environment);
}

function desktopCapabilityPackages(
  configured: PackageSource[],
  environment: NodeJS.ProcessEnv
): PackageSource[] {
  const managedRoot = nonEmpty(environment.PI67_MANAGED_CAPABILITIES_ROOT);
  const serialized = nonEmpty(environment.PI67_CAPABILITY_PACKAGE_PATHS);
  if (!managedRoot || !serialized || !isAbsolute(managedRoot)) return configured;
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
  const result = structuredClone(configured);
  const configuredSources = new Set(result.map((entry) => typeof entry === "string" ? entry : entry.source));
  for (const path of candidates) {
    if (!configuredSources.has(path)) result.push(path);
  }
  return result;
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
