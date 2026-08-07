import { isAbsolute } from "node:path";
import type {
  ExtensionPackageEntry,
  ExtensionPackageIntegrityReason,
  ExtensionPackageScope,
  ExtensionPackageTrustState,
  PackageSourceKind
} from "@pi67/domain";
import type {
  DefaultPackageManager,
  PackageSource,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import {
  PackageMutationReceiptStore,
  type ExtensionPackageObservation
} from "./package-mutation-receipt-store.js";
import {
  inspectPackageInstallation,
  isContainedPackagePath,
  normalizePackageAbsolutePath,
  type PackageObservationResult
} from "./package-trust-inspection.js";

export {
  inspectPackageInstallation,
  type PackageObservationResult
} from "./package-trust-inspection.js";

type TrustProjection = Pick<ExtensionPackageEntry,
  | "trustState"
  | "trustReason"
  | "trustObservedAt"
  | "manifestSha256"
  | "contentSha256"
>;
type UnavailableReason = Extract<ExtensionPackageIntegrityReason,
  "install-content-missing" | "receipt-invalid" | "inspection-limited">;

export interface PackageTrustRegistryOptions {
  packageManager: Pick<DefaultPackageManager, "listConfiguredPackages">;
  settingsManager: Pick<SettingsManager, "getGlobalSettings" | "getProjectSettings">;
  receipts: PackageMutationReceiptStore;
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
}

/** Revalidates installed package content and projects durable receipt trust. */
export class PackageTrustRegistry {
  readonly #options: PackageTrustRegistryOptions;
  readonly #projections = new Map<string, TrustProjection>();
  readonly #observations = new Map<string, PackageObservationResult>();
  #refreshPromise: Promise<void> | undefined;

  constructor(options: PackageTrustRegistryOptions) {
    this.#options = options;
  }

  refresh(): Promise<void> {
    this.#refreshPromise ??= this.#refresh().finally(() => { this.#refreshPromise = undefined; });
    return this.#refreshPromise;
  }

  projectionFor(source: string, scope: ExtensionPackageScope): TrustProjection {
    return this.#projections.get(packageKey(source, scope)) ?? {
      trustState: "unverified",
      trustReason: "receipt-missing"
    };
  }

  observationFor(source: string, scope: ExtensionPackageScope): PackageObservationResult | undefined {
    const value = this.#observations.get(packageKey(source, scope));
    return value === undefined ? undefined : structuredClone(value);
  }

  runtimePackageAllowed(source: string, scope: ExtensionPackageScope): boolean {
    const environment = this.#options.environment ?? process.env;
    if (verifiedDesktopCapabilitySources(environment).has(normalizePackageAbsolutePath(source))) return true;
    const state = this.projectionFor(source, scope).trustState;
    return state === "user-installed-observed";
  }

  async #refresh(): Promise<void> {
    const environment = this.#options.environment ?? process.env;
    const verifiedBuiltins = verifiedDesktopCapabilitySources(environment);
    const configured = resolveConfiguredInstallations(
      this.#options.packageManager,
      this.#options.settingsManager,
      environment
    );
    const projections = new Map<string, TrustProjection>();
    const observations = new Map<string, PackageObservationResult>();
    for (const entry of configured) {
      const key = packageKey(entry.source, entry.scope);
      if (entry.installedPath === undefined) {
        const result = { status: "unavailable", reason: "install-content-missing" } as const;
        observations.set(key, result);
        projections.set(key, unavailableProjection(result.reason));
        continue;
      }
      if (verifiedBuiltins.has(normalizePackageAbsolutePath(entry.source))) {
        projections.set(key, {
          trustState: "builtin-verified",
          trustObservedAt: timestamp(this.#options.now)
        });
        continue;
      }
      const observation = await inspectPackageInstallation(entry.installedPath, this.#options.now);
      observations.set(key, observation);
      if (observation.status !== "observed") {
        projections.set(key, unavailableProjection(observation.reason));
        continue;
      }
      const receipt = this.#options.receipts.read(entry.receiptSource, entry.receiptScope);
      projections.set(key, projectReceiptTrust(receipt, observation.observation, entry.sourceKind));
    }
    this.#projections.clear();
    this.#observations.clear();
    for (const [key, projection] of projections) this.#projections.set(key, projection);
    for (const [key, observation] of observations) this.#observations.set(key, observation);
  }
}

interface ConfiguredInstallation {
  source: string;
  scope: ExtensionPackageScope;
  receiptSource: string;
  receiptScope: ExtensionPackageScope;
  sourceKind: PackageSourceKind;
  installedPath?: string;
}

function resolveConfiguredInstallations(
  packageManager: PackageTrustRegistryOptions["packageManager"],
  settingsManager: PackageTrustRegistryOptions["settingsManager"],
  environment: NodeJS.ProcessEnv
): ConfiguredInstallation[] {
  const configured = packageManager.listConfiguredPackages();
  const globalSettings = settingsManager.getGlobalSettings();
  const projectSettings = settingsManager.getProjectSettings();
  const globalInstalled = new Map(configured
    .filter((entry) => entry.scope === "user")
    .map((entry) => [entry.source, entry.installedPath]));
  return configured.map((entry) => {
    const scope = entry.scope === "user" ? "global" : "project";
    const raw = packagesForSettings(scope === "global" ? globalSettings.packages : projectSettings.packages)
      .find((candidate) => packageSource(candidate) === entry.source);
    const inherited = scope === "project" && isInheritanceDelta(raw)
      ? globalInstalled.get(entry.source)
      : undefined;
    const installedPath = entry.installedPath ?? inherited;
    return {
      source: entry.source,
      scope,
      receiptSource: entry.source,
      receiptScope: inherited === undefined ? scope : "global",
      sourceKind: packageSourceKind(entry.source, environment),
      ...(installedPath === undefined ? {} : { installedPath })
    };
  });
}

function projectReceiptTrust(
  receipt: ReturnType<PackageMutationReceiptStore["read"]>,
  observation: ExtensionPackageObservation,
  sourceKind: PackageSourceKind
): TrustProjection {
  if (receipt.status === "invalid") return unverifiedProjection("receipt-invalid", observation);
  if (receipt.status === "missing") return unverifiedProjection("receipt-missing", observation);
  const record = receipt.record;
  if (sourceKind === "bundled" || record.sourceKind !== sourceKind) {
    return driftedProjection("package-identity-changed", observation);
  }
  if (record.state === "reserved" || record.state === "mutating" || record.state === "ambiguous") {
    return unverifiedProjection("mutation-ambiguous", observation);
  }
  if (record.state === "removed" || !record.observation) {
    return driftedProjection("package-identity-changed", observation);
  }
  if (record.observation.directoryIdentityDigest !== observation.directoryIdentityDigest) {
    return driftedProjection("directory-identity-changed", observation);
  }
  if (record.observation.manifestSha256 !== observation.manifestSha256) {
    return driftedProjection("manifest-changed", observation);
  }
  if (record.observation.contentSha256 !== observation.contentSha256) {
    return driftedProjection("content-hash-changed", observation);
  }
  if (
    record.observation.packageName !== observation.packageName
    || record.observation.packageVersion !== observation.packageVersion
  ) {
    return driftedProjection("package-identity-changed", observation);
  }
  return {
    trustState: "user-installed-observed",
    trustObservedAt: observation.observedAt,
    manifestSha256: observation.manifestSha256,
    contentSha256: observation.contentSha256
  };
}

function unavailableProjection(reason: UnavailableReason): TrustProjection {
  return { trustState: "unavailable", trustReason: reason };
}

function unverifiedProjection(
  reason: Extract<ExtensionPackageIntegrityReason, "receipt-invalid" | "receipt-missing" | "mutation-ambiguous">,
  observation: ExtensionPackageObservation
): TrustProjection {
  return {
    trustState: "unverified",
    trustReason: reason,
    trustObservedAt: observation.observedAt,
    manifestSha256: observation.manifestSha256,
    contentSha256: observation.contentSha256
  };
}

function driftedProjection(
  reason: Extract<ExtensionPackageIntegrityReason,
    "package-identity-changed" | "manifest-changed" | "directory-identity-changed" | "content-hash-changed">,
  observation: ExtensionPackageObservation
): TrustProjection {
  return {
    trustState: "drifted",
    trustReason: reason,
    trustObservedAt: observation.observedAt,
    manifestSha256: observation.manifestSha256,
    contentSha256: observation.contentSha256
  };
}

export function packageSourceKind(source: string, environment: NodeJS.ProcessEnv = process.env): PackageSourceKind {
  const normalized = source.trim();
  if (verifiedDesktopCapabilitySources(environment).has(normalizePackageAbsolutePath(normalized))) return "bundled";
  if (
    normalized.startsWith("git:")
    || normalized.startsWith("git+")
    || normalized.startsWith("git@")
    || normalized.startsWith("github:")
    || normalized.startsWith("http://")
    || normalized.startsWith("https://")
    || normalized.includes("github.com/")
    || normalized.endsWith(".git")
  ) return "git";
  if (isAbsolute(normalized) || normalized.startsWith("./") || normalized.startsWith("../")) return "path";
  return "npm";
}

export function verifiedDesktopCapabilitySources(environment: NodeJS.ProcessEnv = process.env): Set<string> {
  const managedRoot = environment.PI67_MANAGED_CAPABILITIES_ROOT;
  const serialized = environment.PI67_CAPABILITY_PACKAGE_PATHS;
  if (!managedRoot || !isAbsolute(managedRoot) || !serialized) return new Set();
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!Array.isArray(value) || value.length > 32) return new Set();
    const result = new Set<string>();
    for (const candidate of value) {
      if (typeof candidate !== "string" || !isContainedPackagePath(candidate, managedRoot)) return new Set();
      result.add(normalizePackageAbsolutePath(candidate));
    }
    return result;
  } catch {
    return new Set();
  }
}

function packagesForSettings(packages: PackageSource[] | undefined): PackageSource[] {
  return packages ? structuredClone(packages) : [];
}

function packageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function isInheritanceDelta(entry: PackageSource | undefined): boolean {
  return typeof entry === "object" && entry.autoload === false;
}

function packageKey(source: string, scope: ExtensionPackageScope): string {
  return `${scope}\0${source.trim()}`;
}

function timestamp(now: (() => number) | undefined): number {
  const value = (now ?? Date.now)();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Package observation timestamp is invalid.");
  return value;
}

export function trustStateBlocksRuntime(state: ExtensionPackageTrustState): boolean {
  return state !== "builtin-verified" && state !== "user-installed-observed";
}
