import type {
  ExtensionPackageEntry,
  ExtensionPackageListResult,
  ExtensionPackageMutationResult,
  ExtensionPackageScope,
  ExtensionPackageUpdatesResult
} from "@pi67/domain";
import type {
  DefaultPackageManager,
  PackageSource,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";

const MAX_PACKAGE_SOURCE_LENGTH = 4_096;

type PackageUpdates = Awaited<ReturnType<DefaultPackageManager["checkForAvailableUpdates"]>>;

export interface ExtensionPackageManagementServices {
  packageManager: Pick<DefaultPackageManager,
    | "checkForAvailableUpdates"
    | "installAndPersist"
    | "listConfiguredPackages"
    | "removeAndPersist"
    | "removeSourceFromSettings"
    | "update"
  >;
  settingsManager: Pick<SettingsManager,
    | "flush"
    | "getGlobalSettings"
    | "getProjectSettings"
    | "setPackages"
    | "setProjectPackages"
  >;
}

export class ExtensionPackageManagement {
  constructor(private readonly services: ExtensionPackageManagementServices) {}

  list(): ExtensionPackageListResult {
    return packageList(this.services);
  }

  async checkForUpdates(): Promise<ExtensionPackageUpdatesResult> {
    const updates = await this.services.packageManager.checkForAvailableUpdates();
    return updateList(updates);
  }

  async install(source: string, scope: ExtensionPackageScope): Promise<ExtensionPackageMutationResult> {
    const normalizedSource = validSource(source);
    const before = this.list();
    await this.services.packageManager.installAndPersist(normalizedSource, scopeOptions(scope));
    await this.services.settingsManager.flush();
    return mutationResult(before, this.list());
  }

  async update(source: string, scope: ExtensionPackageScope): Promise<ExtensionPackageMutationResult> {
    const normalizedSource = validSource(source);
    this.requireConfigured(normalizedSource, scope);
    const before = this.list();
    // Pi's public API reconciles every configured entry matching this package identity.
    await this.services.packageManager.update(normalizedSource);
    return { ...this.list(), changed: before.items.length > 0 };
  }

  async setEnabled(
    source: string,
    scope: ExtensionPackageScope,
    enabled: boolean
  ): Promise<ExtensionPackageMutationResult> {
    const normalizedSource = validSource(source);
    const before = this.list();
    const packages = packagesForScope(this.services.settingsManager, scope);
    const index = packages.findIndex((entry) => packageSource(entry) === normalizedSource);
    if (index === -1) {
      if (scope !== "project" || !before.items.some((entry) => (
        entry.scope === "global" && entry.source === normalizedSource
      ))) {
        throw notConfigured(normalizedSource, scope);
      }
      packages.push({
        source: normalizedSource,
        autoload: false,
        extensions: enabled ? ["**/*"] : ["!**/*"]
      });
    } else {
      packages[index] = packageWithExtensionState(packages[index]!, enabled);
    }
    setPackagesForScope(this.services.settingsManager, scope, packages);
    await this.services.settingsManager.flush();
    return mutationResult(before, this.list());
  }

  async restoreProjectInheritance(source: string): Promise<ExtensionPackageMutationResult> {
    const normalizedSource = validSource(source);
    const before = this.list();
    const changed = this.services.packageManager.removeSourceFromSettings(normalizedSource, { local: true });
    await this.services.settingsManager.flush();
    const after = this.list();
    return { ...after, changed: changed || JSON.stringify(before.items) !== JSON.stringify(after.items) };
  }

  async uninstall(source: string, scope: ExtensionPackageScope): Promise<ExtensionPackageMutationResult> {
    const normalizedSource = validSource(source);
    this.requireConfigured(normalizedSource, scope);
    const changed = await this.services.packageManager.removeAndPersist(normalizedSource, scopeOptions(scope));
    await this.services.settingsManager.flush();
    return { ...this.list(), changed };
  }

  private requireConfigured(source: string, scope: ExtensionPackageScope): void {
    if (!this.list().items.some((entry) => entry.source === source && entry.scope === scope)) {
      throw notConfigured(source, scope);
    }
  }
}

function packageList(services: ExtensionPackageManagementServices): ExtensionPackageListResult {
  const configured = services.packageManager.listConfiguredPackages();
  const globalSettings = services.settingsManager.getGlobalSettings();
  const projectSettings = services.settingsManager.getProjectSettings();
  const globalInstalled = new Map(configured
    .filter((entry) => entry.scope === "user")
    .map((entry) => [entry.source, entry.installedPath !== undefined]));
  const items = configured.map((entry): ExtensionPackageEntry => {
    const scope = entry.scope === "user" ? "global" : "project";
    const raw = packagesForSettings(scope === "global" ? globalSettings.packages : projectSettings.packages)
      .find((candidate) => packageSource(candidate) === entry.source);
    return {
      source: entry.source,
      scope,
      enabled: raw === undefined ? true : packageExtensionsEnabled(raw),
      filtered: entry.filtered,
      installed: entry.installedPath !== undefined
        || (scope === "project" && isInheritanceDelta(raw) && globalInstalled.get(entry.source) === true)
    };
  });
  return { items, total: items.length };
}

function updateList(updates: PackageUpdates): ExtensionPackageUpdatesResult {
  const items = updates.map((update) => ({
    source: update.source,
    displayName: update.displayName,
    type: update.type,
    scope: update.scope === "user" ? "global" as const : "project" as const
  }));
  return { items, total: items.length };
}

function mutationResult(
  before: ExtensionPackageListResult,
  after: ExtensionPackageListResult
): ExtensionPackageMutationResult {
  return { ...after, changed: JSON.stringify(before.items) !== JSON.stringify(after.items) };
}

function packagesForScope(
  settings: ExtensionPackageManagementServices["settingsManager"],
  scope: ExtensionPackageScope
): PackageSource[] {
  return packagesForSettings(
    scope === "global"
      ? settings.getGlobalSettings().packages
      : settings.getProjectSettings().packages
  );
}

function packagesForSettings(packages: PackageSource[] | undefined): PackageSource[] {
  return packages ? structuredClone(packages) : [];
}

function setPackagesForScope(
  settings: ExtensionPackageManagementServices["settingsManager"],
  scope: ExtensionPackageScope,
  packages: PackageSource[]
): void {
  if (scope === "global") settings.setPackages(packages);
  else settings.setProjectPackages(packages);
}

function packageWithExtensionState(entry: PackageSource, enabled: boolean): PackageSource {
  const source = packageSource(entry);
  if (enabled && typeof entry === "string") return entry;
  const filtered = typeof entry === "string" ? { source } : { ...entry };
  if (enabled && filtered.autoload !== false) delete filtered.extensions;
  else if (filtered.autoload === false) filtered.extensions = enabled ? ["**/*"] : ["!**/*"];
  else filtered.extensions = [];
  return filtered;
}

function packageExtensionsEnabled(entry: PackageSource): boolean {
  if (typeof entry === "string") return true;
  if (entry.extensions !== undefined) {
    return entry.extensions.some((pattern) => !pattern.startsWith("!") && !pattern.startsWith("-"));
  }
  return entry.autoload !== false;
}

function isInheritanceDelta(entry: PackageSource | undefined): boolean {
  return typeof entry === "object" && entry.autoload === false;
}

function packageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function scopeOptions(scope: ExtensionPackageScope): { local?: boolean } {
  return scope === "project" ? { local: true } : {};
}

function validSource(source: string): string {
  const normalized = source.trim();
  if (!normalized || normalized.length > MAX_PACKAGE_SOURCE_LENGTH || normalized.includes("\0")) {
    throw new RuntimeError("INVALID_PAYLOAD", "The Extension package source is invalid.");
  }
  return normalized;
}

function notConfigured(source: string, scope: ExtensionPackageScope): RuntimeError {
  return new RuntimeError(
    "INVALID_PAYLOAD",
    `The Extension package is not configured in the ${scope} scope.`,
    { details: { source, scope } }
  );
}
