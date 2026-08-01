import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ExtensionPackageEntry,
  ExtensionPackageListResult,
  ExtensionPackageMutationResult,
  ExtensionPackageScope,
  ExtensionPackageUpdatesResult,
  PackageResourceType,
  PackageSourceKind
} from "@pi67/domain";
import type {
  DefaultPackageManager,
  PackageSource,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";

const MAX_PACKAGE_SOURCE_LENGTH = 4_096;
const MAX_PACKAGE_MANIFEST_BYTES = 1_000_000;
const MAX_PACKAGE_DISPLAY_NAME_LENGTH = 200;
const MAX_PACKAGE_VERSION_LENGTH = 100;
const MAX_PACKAGE_DESCRIPTION_LENGTH = 320;

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
    assertExternallyMutable(normalizedSource, "update");
    this.requireConfigured(normalizedSource, scope);
    const before = this.list();
    // Pi's public API reconciles every configured entry matching this package identity.
    await this.services.packageManager.update(normalizedSource);
    const after = this.list();
    return {
      ...after,
      changed: packageUpdateChanged(before, after, normalizedSource, scope)
    };
  }

  async setEnabled(
    source: string,
    scope: ExtensionPackageScope,
    enabled: boolean,
    resourceType: PackageResourceType = "extension"
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
        [resourceFilterKey(resourceType)]: enabled ? ["**/*"] : ["!**/*"]
      });
    } else {
      packages[index] = packageWithResourceState(packages[index]!, resourceType, enabled);
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
    assertExternallyMutable(normalizedSource, "uninstall");
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
    .flatMap((entry) => entry.installedPath === undefined ? [] : [[entry.source, entry.installedPath]]));
  const items = configured.map((entry): ExtensionPackageEntry => {
    const scope = entry.scope === "user" ? "global" : "project";
    const raw = packagesForSettings(scope === "global" ? globalSettings.packages : projectSettings.packages)
      .find((candidate) => packageSource(candidate) === entry.source);
    const inheritedPath = scope === "project" && isInheritanceDelta(raw)
      ? globalInstalled.get(entry.source)
      : undefined;
    const installedPath = entry.installedPath ?? inheritedPath;
    const manifest = installedPath ? readPackageManifest(installedPath) : undefined;
    const resourceTypes = packageResourceTypes(installedPath, raw, manifest?.pi);
    return {
      source: entry.source,
      scope,
      enabled: raw === undefined ? true : packageResourceEnabled(raw, "extension"),
      filtered: entry.filtered,
      installed: installedPath !== undefined,
      ...(manifest?.displayName === undefined ? {} : { displayName: manifest.displayName }),
      ...(manifest?.version === undefined ? {} : { version: manifest.version }),
      ...(manifest?.description === undefined ? {} : { description: manifest.description }),
      sourceKind: packageSourceKind(entry.source),
      origin: packageSourceKind(entry.source) === "bundled" ? "first-party" : "external",
      resourceTypes,
      resourceStates: resourceTypes.map((type) => ({
        type,
        enabled: raw === undefined ? true : packageResourceEnabled(raw, type)
      }))
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

function packageUpdateChanged(
  before: ExtensionPackageListResult,
  after: ExtensionPackageListResult,
  source: string,
  scope: ExtensionPackageScope
): boolean {
  const previous = before.items.find((entry) => entry.source === source && entry.scope === scope);
  const current = after.items.find((entry) => entry.source === source && entry.scope === scope);
  if (!previous || !current) return JSON.stringify(previous) !== JSON.stringify(current);
  if (previous.version && current.version && previous.sourceKind === "npm") {
    return previous.version !== current.version;
  }
  if (JSON.stringify(previous) !== JSON.stringify(current)) return true;
  // Git revisions and packages without a manifest version are not represented in the list projection.
  return previous.sourceKind === "git" || previous.version === undefined;
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

function packageWithResourceState(
  entry: PackageSource,
  resourceType: PackageResourceType,
  enabled: boolean
): PackageSource {
  const source = packageSource(entry);
  if (enabled && typeof entry === "string") return entry;
  const filtered = typeof entry === "string" ? { source } : { ...entry };
  const key = resourceFilterKey(resourceType);
  if (enabled && filtered.autoload !== false) delete filtered[key];
  else if (filtered.autoload === false) filtered[key] = enabled ? ["**/*"] : ["!**/*"];
  else filtered[key] = [];
  return filtered;
}

function packageResourceEnabled(entry: PackageSource, resourceType: PackageResourceType): boolean {
  if (typeof entry === "string") return true;
  const patterns = entry[resourceFilterKey(resourceType)];
  if (patterns !== undefined) {
    return patterns.some((pattern) => !pattern.startsWith("!") && !pattern.startsWith("-"));
  }
  return entry.autoload !== false;
}

function resourceFilterKey(
  resourceType: PackageResourceType
): "extensions" | "skills" | "prompts" | "themes" {
  if (resourceType === "extension") return "extensions";
  if (resourceType === "skill") return "skills";
  if (resourceType === "prompt") return "prompts";
  return "themes";
}

function packageResourceTypes(
  installedPath: string | undefined,
  configured: PackageSource | undefined,
  manifest: PiPackageManifest | undefined
): PackageResourceType[] {
  const types = new Set<PackageResourceType>();
  if (typeof configured === "object") {
    for (const type of PACKAGE_RESOURCE_TYPES) {
      if (configured[resourceFilterKey(type)] !== undefined) types.add(type);
    }
  }
  if (installedPath) {
    for (const type of PACKAGE_RESOURCE_TYPES) {
      const key = resourceFilterKey(type);
      if (Array.isArray(manifest?.[key]) || existsSync(join(installedPath, key))) types.add(type);
    }
    if (
      types.size === 0
      && (existsSync(join(installedPath, "index.ts")) || existsSync(join(installedPath, "index.js")))
    ) types.add("extension");
  }
  if (types.size === 0) types.add("extension");
  return PACKAGE_RESOURCE_TYPES.filter((type) => types.has(type));
}

type PiPackageManifest = Partial<Record<"extensions" | "skills" | "prompts" | "themes", unknown>>;

interface PackageManifestProjection {
  displayName?: string;
  version?: string;
  description?: string;
  pi?: PiPackageManifest;
}

function readPackageManifest(installedPath: string): PackageManifestProjection | undefined {
  const path = join(installedPath, "package.json");
  try {
    if (!existsSync(path) || statSync(path).size > MAX_PACKAGE_MANIFEST_BYTES) return undefined;
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(value)) return undefined;
    const displayName = boundedManifestText(value.name, MAX_PACKAGE_DISPLAY_NAME_LENGTH);
    const version = boundedManifestText(value.version, MAX_PACKAGE_VERSION_LENGTH);
    const description = boundedManifestText(value.description, MAX_PACKAGE_DESCRIPTION_LENGTH);
    const pi = isRecord(value.pi) ? value.pi as PiPackageManifest : undefined;
    return {
      ...(displayName === undefined ? {} : { displayName }),
      ...(version === undefined ? {} : { version }),
      ...(description === undefined ? {} : { description }),
      ...(pi === undefined ? {} : { pi })
    };
  } catch {
    return undefined;
  }
}

function boundedManifestText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  let sanitized = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    sanitized += code <= 0x1f || code === 0x7f ? " " : character;
  }
  const normalized = sanitized
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximum).trimEnd();
}

function packageSourceKind(source: string): PackageSourceKind {
  const capabilitiesRoot = process.env.PI67_MANAGED_CAPABILITIES_ROOT
    ?? process.env.PI67_CAPABILITIES_ROOT;
  if (
    source.startsWith("pi67-bundled:")
    || (capabilitiesRoot && isPathWithin(source, capabilitiesRoot))
  ) return "bundled";
  if (source.startsWith("git+") || source.startsWith("git@") || source.includes("github.com/") || source.endsWith(".git")) {
    return "git";
  }
  if (isAbsolute(source) || source.startsWith("./") || source.startsWith("../")) return "path";
  return "npm";
}

function isPathWithin(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PACKAGE_RESOURCE_TYPES: readonly PackageResourceType[] = ["extension", "skill", "prompt", "theme"];

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

function assertExternallyMutable(source: string, operation: "update" | "uninstall"): void {
  if (packageSourceKind(source) !== "bundled") return;
  throw new RuntimeError(
    "UNSUPPORTED",
    `Bundled Pi-67 capabilities cannot be ${operation === "update" ? "updated" : "uninstalled"} independently.`,
    { recoverable: false, details: { sourceKind: "bundled", operation } }
  );
}
