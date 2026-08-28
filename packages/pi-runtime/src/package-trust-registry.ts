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
  inspectInstallation?: (
    installedPath: string,
    now?: () => number
  ) => Promise<PackageObservationResult>;
}

const MAX_CONCURRENT_PACKAGE_INSPECTIONS = 4;

/** Revalidates installed package content and projects durable receipt trust. */
export class PackageTrustRegistry {
  readonly #options: PackageTrustRegistryOptions;
  readonly #projections = new Map<string, TrustProjection>();
  readonly #observations = new Map<string, PackageObservationResult>();
  readonly #inspectInstallation: NonNullable<PackageTrustRegistryOptions["inspectInstallation"]>;
  #refreshPromise: Promise<void> | undefined;

  constructor(options: PackageTrustRegistryOptions) {
    this.#options = options;
    this.#inspectInstallation = options.inspectInstallation ?? inspectPackageInstallation;
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
    return state === "known-baseline-observed"
      || state === "user-approved-observed"
      || state === "user-installed-observed";
  }

  async #refresh(): Promise<void> {
    const environment = this.#options.environment ?? process.env;
    const verifiedBuiltins = verifiedDesktopCapabilitySources(environment);
    const knownBaselines = knownPackageBaselines(environment);
    const configured = resolveConfiguredInstallations(
      this.#options.packageManager,
      this.#options.settingsManager,
      environment
    );
    const inspectionTargets = new Map<string, string>();
    for (const entry of configured) {
      if (
        entry.installedPath !== undefined
        && !verifiedBuiltins.has(normalizePackageAbsolutePath(entry.source))
      ) {
        inspectionTargets.set(
          normalizePackageAbsolutePath(entry.installedPath),
          entry.installedPath
        );
      }
    }
    const inspections = await inspectPackageInstallations(
      [...inspectionTargets].map(([key, path]) => ({ key, path })),
      this.#inspectInstallation,
      this.#options.now
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
      const observation = inspections.get(normalizePackageAbsolutePath(entry.installedPath));
      if (!observation) throw new Error("Package trust inspection result is missing.");
      observations.set(key, observation);
      if (observation.status !== "observed") {
        projections.set(key, unavailableProjection(observation.reason));
        continue;
      }
      if (matchesKnownBaseline(entry.source, observation, knownBaselines)) {
        projections.set(key, {
          trustState: "known-baseline-observed",
          trustObservedAt: observation.observation.observedAt,
          manifestSha256: observation.observation.manifestSha256,
          contentSha256: observation.observation.contentSha256
        });
        continue;
      }
      let receipt = this.#options.receipts.read(entry.receiptSource, entry.receiptScope);
      if (receipt.status === "missing" && entry.fallbackReceiptScope !== undefined) {
        receipt = this.#options.receipts.read(entry.receiptSource, entry.fallbackReceiptScope);
      }
      projections.set(key, projectReceiptTrust(receipt, observation.observation, entry.sourceKind));
    }
    this.#projections.clear();
    this.#observations.clear();
    for (const [key, projection] of projections) this.#projections.set(key, projection);
    for (const [key, observation] of observations) this.#observations.set(key, observation);
  }
}

interface PackageInspectionTarget {
  key: string;
  path: string;
}

async function inspectPackageInstallations(
  targets: PackageInspectionTarget[],
  inspectInstallation: NonNullable<PackageTrustRegistryOptions["inspectInstallation"]>,
  now: (() => number) | undefined
): Promise<Map<string, PackageObservationResult>> {
  const results = new Map<string, PackageObservationResult>();
  let nextIndex = 0;
  const workerCount = Math.min(MAX_CONCURRENT_PACKAGE_INSPECTIONS, targets.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < targets.length) {
      const target = targets[nextIndex];
      nextIndex += 1;
      if (!target) return;
      results.set(target.key, await inspectInstallation(target.path, now));
    }
  }));
  return results;
}

interface ConfiguredInstallation {
  source: string;
  scope: ExtensionPackageScope;
  receiptSource: string;
  receiptScope: ExtensionPackageScope;
  fallbackReceiptScope?: ExtensionPackageScope;
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
      receiptScope: scope,
      ...(inherited === undefined ? {} : { fallbackReceiptScope: "global" as const }),
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
    trustState: record.lastOperation === "admit"
      ? "user-approved-observed"
      : "user-installed-observed",
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
  const roots = [
    environment.PI67_BUNDLED_CAPABILITIES_ROOT,
    environment.PI67_MANAGED_CAPABILITIES_ROOT
  ].filter((root): root is string => typeof root === "string" && isAbsolute(root));
  const serialized = environment.PI67_CAPABILITY_PACKAGE_PATHS;
  if (roots.length === 0 || !serialized) return new Set();
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!Array.isArray(value) || value.length > 32) return new Set();
    const result = new Set<string>();
    for (const candidate of value) {
      if (
        typeof candidate !== "string"
        || !roots.some((root) => isContainedPackagePath(candidate, root))
      ) return new Set();
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
  return state !== "builtin-verified"
    && state !== "known-baseline-observed"
    && state !== "user-approved-observed"
    && state !== "user-installed-observed";
}

interface KnownPackageBaseline {
  source: string;
  packageName: string;
  packageVersion: string;
  baselineContentSha256: string;
}

function knownPackageBaselines(environment: NodeJS.ProcessEnv): KnownPackageBaseline[] {
  const serialized = environment.PI67_KNOWN_PACKAGE_BASELINES;
  if (!serialized) return [];
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!Array.isArray(value) || value.length > 64) return [];
    const result: KnownPackageBaseline[] = [];
    for (const entry of value) {
      if (
        !isRecord(entry)
        || typeof entry.source !== "string"
        || !entry.source.startsWith("npm:")
        || entry.source.length > 4_096
        || !boundedText(entry.packageName, 200)
        || !boundedText(entry.packageVersion, 100)
        || typeof entry.baselineContentSha256 !== "string"
        || !/^[a-f0-9]{64}$/u.test(entry.baselineContentSha256)
      ) return [];
      result.push({
        source: entry.source,
        packageName: entry.packageName,
        packageVersion: entry.packageVersion,
        baselineContentSha256: entry.baselineContentSha256
      });
    }
    if (new Set(result.map((entry) => entry.source)).size !== result.length) return [];
    return result;
  } catch {
    return [];
  }
}

function matchesKnownBaseline(
  source: string,
  observation: Extract<PackageObservationResult, { status: "observed" }>,
  baselines: KnownPackageBaseline[]
): boolean {
  const baseline = baselines.find((entry) => entry.source === source);
  return baseline !== undefined
    && observation.observation.packageName === baseline.packageName
    && observation.observation.packageVersion === baseline.packageVersion
    && observation.baselineContentSha256 === baseline.baselineContentSha256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    });
}
