import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  npmRegistryCandidates,
  type DesktopCapabilitySnapshot
} from "@pi67/protocol";
import {
  INTEGRATION_STATE_SCHEMA,
  boundedError,
  emptyCapabilitySnapshot,
  isNodeError,
  parseBundledCatalog,
  parseManagedState,
  readBoundedJson,
  snapshotFromCatalog,
  type Browser67IntegrationState,
  type BundledCapabilityCatalog,
  type ManagedCapabilityState
} from "./desktop-capability-contract.js";
import { Browser67IntegrationStateStore } from "./browser67-integration-state-store.js";
import { isContainedManagedCapabilityPath } from "./managed-capability-path.js";
import {
  assertSafeBrowser67ExtensionTarget,
  detectBrowser67Browsers,
  resolveBrowser67Home,
  type Browser67BrowserId
} from "./browser67-integration.js";
import {
  browser67DependenciesPrepared,
  runBrowser67EntrypointCheck,
  runBrowser67ExtensionDoctor,
  runBrowser67ExtensionReload,
  runBrowser67ExtensionSetup,
  runBrowser67LiveDoctor,
  runBrowser67NpmInstall,
  type Browser67ProcessRunners
} from "./browser67-capability-process.js";
import { verifyBrowser67LiveIdentity } from "./browser67-live-identity-verification.js";
import {
  browser67PackageIdentity,
  readBrowser67IntegrationStatus
} from "./browser67-integration-status.js";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import type { PackageNetworkSettingsStore } from "./package-network-settings.js";
export interface DesktopCapabilityServiceOptions extends Partial<Browser67ProcessRunners> {
  capabilitiesRoot: string;
  capabilityProjectionMode: "packaged-direct" | "legacy-copy" | "shared-profile";
  agentDir: string;
  toolchain: DesktopToolchain;
  packageNetworkSettings: PackageNetworkSettingsStore;
  browser67Home?: string;
  browser67ExtensionDirectory?: string;
  availableBrowsers?: () => Browser67BrowserId[];
  now?: () => number;
  createToken?: () => string;
}

export class DesktopCapabilityService {
  readonly #capabilitiesRoot: string;
  readonly #managedRoot: string;
  readonly #capabilityProjectionMode: DesktopCapabilityServiceOptions["capabilityProjectionMode"];
  readonly #browser67PackageRoots: readonly string[];
  readonly #toolchain: DesktopToolchain;
  readonly #packageNetworkSettings: PackageNetworkSettingsStore;
  readonly #runNpm: NonNullable<DesktopCapabilityServiceOptions["runNpm"]>;
  readonly #runBrowserEntrypointCheck: NonNullable<DesktopCapabilityServiceOptions["runBrowserEntrypointCheck"]>;
  readonly #runBrowserExtensionSetup: NonNullable<DesktopCapabilityServiceOptions["runBrowserExtensionSetup"]>;
  readonly #runBrowserExtensionDoctor: NonNullable<DesktopCapabilityServiceOptions["runBrowserExtensionDoctor"]>;
  readonly #runBrowserLiveDoctor: NonNullable<DesktopCapabilityServiceOptions["runBrowserLiveDoctor"]>;
  readonly #runBrowserExtensionReload: NonNullable<DesktopCapabilityServiceOptions["runBrowserExtensionReload"]>;
  readonly #browser67Home: string;
  readonly #browser67ExtensionDirectory: string;
  readonly #availableBrowsers: () => Browser67BrowserId[];
  readonly #now: () => number;
  readonly #createToken: () => string;
  readonly #browserState: Browser67IntegrationStateStore;
  #pending: Promise<void> = Promise.resolve();
  #liveIdentityVerified = false;

  constructor(options: DesktopCapabilityServiceOptions) {
    this.#capabilitiesRoot = resolve(options.capabilitiesRoot);
    this.#managedRoot = join(resolve(options.agentDir), "desktop-capabilities");
    this.#capabilityProjectionMode = options.capabilityProjectionMode;
    const browser67PackageContainmentRoots = options.capabilityProjectionMode === "packaged-direct"
      ? [this.#capabilitiesRoot]
      : options.capabilityProjectionMode === "shared-profile"
        ? [join(this.#managedRoot, "shared-profile", "active"), this.#capabilitiesRoot]
        : [this.#managedRoot];
    this.#browser67PackageRoots = browser67PackageContainmentRoots.map((root) => {
      const packageRoot = join(root, "packages", "browser67");
      if (!isContainedManagedCapabilityPath(packageRoot, root)) {
        throw new Error("browser67 package escaped its verified capability root.");
      }
      return packageRoot;
    });
    this.#toolchain = options.toolchain;
    this.#packageNetworkSettings = options.packageNetworkSettings;
    this.#runNpm = options.runNpm ?? runBrowser67NpmInstall;
    this.#runBrowserEntrypointCheck = options.runBrowserEntrypointCheck ?? runBrowser67EntrypointCheck;
    this.#runBrowserExtensionSetup = options.runBrowserExtensionSetup ?? runBrowser67ExtensionSetup;
    this.#runBrowserExtensionDoctor = options.runBrowserExtensionDoctor ?? runBrowser67ExtensionDoctor;
    this.#runBrowserLiveDoctor = options.runBrowserLiveDoctor ?? runBrowser67LiveDoctor;
    this.#runBrowserExtensionReload = options.runBrowserExtensionReload ?? runBrowser67ExtensionReload;
    this.#browser67Home = resolve(options.browser67Home ?? resolveBrowser67Home());
    this.#browser67ExtensionDirectory = resolve(
      options.browser67ExtensionDirectory ?? join(this.#browser67Home, "browser", "tmwd_cdp_bridge")
    );
    this.#availableBrowsers = options.availableBrowsers ?? (() => detectBrowser67Browsers());
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
    this.#browserState = new Browser67IntegrationStateStore(this.#managedRoot, this.#createToken);
  }

  snapshot(): Promise<DesktopCapabilitySnapshot> {
    return this.#enqueue(() => this.#snapshotUnlocked());
  }

  setupBrowser67(): Promise<DesktopCapabilitySnapshot> {
    return this.#enqueue(() => this.#setupBrowser67Unlocked());
  }
  prepareBrowser67Extension(): Promise<DesktopCapabilitySnapshot> {
    return this.#enqueue(async () => {
      if (!browser67DependenciesPrepared(this.#browserPackageRoot())) {
        await this.#setupBrowser67Unlocked();
      }
      const packageRoot = await this.#requireBrowser67Package();
      const previous = await this.#readBrowserState();
      this.#liveIdentityVerified = false;
      try {
        await assertSafeBrowser67ExtensionTarget(this.#browser67Home, this.#browser67ExtensionDirectory, {
          requireManifest: false
        });
        const before = await this.#runBrowserExtensionDoctor(
          packageRoot, this.#browser67ExtensionDirectory, this.#toolchain
        );
        const alreadyCurrent = before.installedCurrent || before.identityMetadataOnlyDrift;
        if (!alreadyCurrent) {
          await this.#runBrowserExtensionSetup(
            packageRoot, this.#browser67ExtensionDirectory, this.#toolchain
          );
        }
        await assertSafeBrowser67ExtensionTarget(this.#browser67Home, this.#browser67ExtensionDirectory, {
          requireManifest: true
        });
        const extension = alreadyCurrent
          ? before
          : await this.#runBrowserExtensionDoctor(
              packageRoot, this.#browser67ExtensionDirectory, this.#toolchain
            );
        if (!extension.installedCurrent && !extension.identityMetadataOnlyDrift) {
          throw new Error("browser67 extension files did not match the bundled source after setup.");
        }
        const browserSyncRequired = previous?.extensionState === "reload-required" || (!alreadyCurrent && previous?.extensionState === "connected");
        let detail = alreadyCurrent ? "扩展文件已是当前内置版本；请验证连接。" : "扩展文件已准备；请在 Chrome 或 Edge 中加载后验证连接。";
        if (previous?.extensionState === "reload-required") {
          detail = alreadyCurrent ? "受管扩展文件已是当前版本；浏览器仍需核对并同步 Desktop 管理的加载来源。" : "受管扩展文件已更新；浏览器仍需核对并同步 Desktop 管理的加载来源。";
        } else if (!alreadyCurrent && previous?.extensionState === "connected") {
          try {
            await this.#runBrowserExtensionReload(packageRoot, this.#toolchain);
            detail = "扩展文件已更新并请求浏览器重新加载；请验证连接。";
          } catch {
            detail = "扩展文件已更新；当前连接无法自动重新加载，请在扩展页手动重新加载。";
          }
        }
        const now = this.#now();
        await this.#writeBrowserState({
          schema: INTEGRATION_STATE_SCHEMA,
          dependencyState: "prepared",
          extensionState: browserSyncRequired ? "reload-required" : "prepared",
          doctorState: "degraded",
          detail,
          ...(previous?.preparedAt === undefined ? {} : { preparedAt: previous.preparedAt }),
          ...(previous?.registry === undefined ? {} : { registry: previous.registry }),
          extensionPreparedAt: now,
          extensionCheckedAt: now
        });
        return this.#snapshotUnlocked();
      } catch (error) {
        const now = this.#now();
        await this.#writeBrowserState({
          schema: INTEGRATION_STATE_SCHEMA,
          dependencyState: "prepared",
          extensionState: "failed",
          doctorState: "failed",
          detail: boundedError(error),
          ...(previous?.preparedAt === undefined ? {} : { preparedAt: previous.preparedAt }),
          ...(previous?.registry === undefined ? {} : { registry: previous.registry }),
          checkedAt: now,
          extensionCheckedAt: now
        });
        throw new Error(`browser67 extension could not be prepared: ${boundedError(error)}`);
      }
    });
  }

  doctorBrowser67(): Promise<DesktopCapabilitySnapshot> {
    return this.#enqueue(() => this.#diagnoseBrowser67Unlocked(false));
  }

  verifyBrowser67Extension(options: { startHub: boolean }): Promise<DesktopCapabilitySnapshot> {
    return this.#enqueue(() => this.#diagnoseBrowser67Unlocked(options.startHub));
  }

  async browser67ExtensionManifestPath(): Promise<string> {
    return assertSafeBrowser67ExtensionTarget(
      this.#browser67Home,
      this.#browser67ExtensionDirectory,
      { requireManifest: true }
    );
  }

  browser67ExtensionDirectory(): string {
    return this.#browser67ExtensionDirectory;
  }

  async #setupBrowser67Unlocked(): Promise<DesktopCapabilitySnapshot> {
    const packageRoot = await this.#requireBrowser67Package();
    if (!this.#toolchain.ready) throw new Error("Desktop private Node/npm/Git toolchain is unavailable.");
    if (browser67DependenciesPrepared(packageRoot)) {
      await this.#runBrowserEntrypointCheck(packageRoot, this.#toolchain);
      const previous = await this.#readBrowserState();
      const now = this.#now();
      await this.#writeBrowserState({
        schema: INTEGRATION_STATE_SCHEMA,
        dependencyState: "prepared",
        extensionState: previous?.extensionState ?? "not-prepared",
        doctorState: previous?.doctorState ?? "not-checked",
        detail: previous?.extensionState === "connected"
          ? "内置运行依赖与扩展连接均已准备。"
          : "内置运行依赖与命令入口已验证；浏览器扩展尚未完成连接。",
        preparedAt: now,
        ...(previous?.checkedAt === undefined ? {} : { checkedAt: previous.checkedAt }),
        ...(previous?.extensionPreparedAt === undefined ? {} : { extensionPreparedAt: previous.extensionPreparedAt }),
        ...(previous?.extensionCheckedAt === undefined ? {} : { extensionCheckedAt: previous.extensionCheckedAt })
      });
      return this.#snapshotUnlocked();
    }
    if (this.#capabilityProjectionMode !== "legacy-copy") {
      throw new Error("Bundled browser67 dependencies are unavailable; reinstall or update Pi-67 Desktop.");
    }
    const candidates = npmRegistryCandidates(await this.#packageNetworkSettings.load());
    if (candidates.length === 0) throw new Error("Package downloads are offline; browser67 dependencies cannot be prepared.");
    const previous = await this.#readBrowserState();
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        await this.#runNpm(candidate.url, packageRoot, this.#toolchain);
        await this.#runBrowserEntrypointCheck(packageRoot, this.#toolchain);
        await this.#writeBrowserState({
          schema: INTEGRATION_STATE_SCHEMA,
          dependencyState: "prepared",
          extensionState: previous?.extensionState ?? "not-prepared",
          doctorState: previous?.doctorState ?? "not-checked",
          detail: previous?.extensionState === "connected"
            ? "运行依赖与扩展连接均已准备。"
            : "运行依赖与命令入口已验证；浏览器扩展尚未完成连接。",
          preparedAt: this.#now(),
          ...(previous?.checkedAt === undefined ? {} : { checkedAt: previous.checkedAt }),
          ...(previous?.extensionPreparedAt === undefined ? {} : { extensionPreparedAt: previous.extensionPreparedAt }),
          ...(previous?.extensionCheckedAt === undefined ? {} : { extensionCheckedAt: previous.extensionCheckedAt }),
          registry: candidate.url
        });
        return this.#snapshotUnlocked();
      } catch (error) {
        lastError = error;
      }
    }
    await this.#writeBrowserState({
      schema: INTEGRATION_STATE_SCHEMA,
      dependencyState: "failed",
      extensionState: previous?.extensionState ?? "not-prepared",
      doctorState: "failed",
      detail: boundedError(lastError),
      checkedAt: this.#now(),
      ...(previous?.extensionPreparedAt === undefined ? {} : { extensionPreparedAt: previous.extensionPreparedAt }),
      ...(previous?.extensionCheckedAt === undefined ? {} : { extensionCheckedAt: previous.extensionCheckedAt })
    });
    throw new Error(`browser67 dependencies could not be prepared: ${boundedError(lastError)}`);
  }

  async #diagnoseBrowser67Unlocked(ensureHub: boolean): Promise<DesktopCapabilitySnapshot> {
    const packageRoot = await this.#requireBrowser67Package();
    const previous = await this.#readBrowserState();
    const dependencyState = browser67DependenciesPrepared(packageRoot) ? "prepared" as const : "not-prepared" as const;
    const now = this.#now();
    if (dependencyState === "not-prepared") {
      this.#liveIdentityVerified = false;
      await this.#writeBrowserState({
        schema: INTEGRATION_STATE_SCHEMA,
        dependencyState,
        extensionState: previous?.extensionState ?? "not-prepared",
        doctorState: "not-checked",
        detail: "browser67 运行依赖尚未准备。",
        checkedAt: now,
        ...(previous?.extensionPreparedAt === undefined ? {} : { extensionPreparedAt: previous.extensionPreparedAt }),
        ...(previous?.extensionCheckedAt === undefined ? {} : { extensionCheckedAt: previous.extensionCheckedAt })
      });
      return this.#snapshotUnlocked();
    }
    let extensionFilesCurrent = false;
    try {
      const extension = await this.#runBrowserExtensionDoctor(
        packageRoot,
        this.#browser67ExtensionDirectory,
        this.#toolchain
      );
      if (!extension.installedCurrent && !extension.identityMetadataOnlyDrift) {
        this.#liveIdentityVerified = false;
        const extensionState = extension.targetStatus === "missing" ? "not-prepared" as const : "reload-required" as const;
        await this.#writeBrowserState({
          schema: INTEGRATION_STATE_SCHEMA,
          dependencyState,
          extensionState,
          doctorState: "degraded",
          detail: extensionState === "not-prepared"
            ? "扩展文件尚未准备，请先安装浏览器扩展。"
            : "受管扩展目录与当前内置版本不一致。请先更新目录，再在扩展管理页核对并同步加载来源。",
          ...(previous?.preparedAt === undefined ? {} : { preparedAt: previous.preparedAt }),
          ...(previous?.registry === undefined ? {} : { registry: previous.registry }),
          checkedAt: now,
          extensionCheckedAt: now
        });
        return this.#snapshotUnlocked();
      }
      extensionFilesCurrent = true;
      const verification = await verifyBrowser67LiveIdentity({
        packageRoot,
        ensureHub,
        toolchain: this.#toolchain,
        runDoctor: this.#runBrowserLiveDoctor,
        runReload: this.#runBrowserExtensionReload
      });
      this.#liveIdentityVerified = verification.live.ready;
      const identity = verification.live.ready
        ? browser67PackageIdentity(parseBundledCatalog(
            await readBoundedJson(join(this.#capabilitiesRoot, "catalog.json"))
          ))
        : undefined;
      await this.#writeBrowserState({
        schema: INTEGRATION_STATE_SCHEMA,
        dependencyState,
        extensionState: verification.extensionState,
        doctorState: verification.live.ready ? "ready" : "degraded",
        detail: verification.detail,
        ...(previous?.preparedAt === undefined ? {} : { preparedAt: previous.preparedAt }),
        ...(previous?.registry === undefined ? {} : { registry: previous.registry }),
        ...(previous?.extensionPreparedAt === undefined ? {} : { extensionPreparedAt: previous.extensionPreparedAt }),
        checkedAt: now,
        extensionCheckedAt: now,
        ...(verification.live.ready && identity !== undefined
          ? { verifiedAt: now, verifiedPackageIdentity: identity }
          : {})
      });
    } catch (error) {
      this.#liveIdentityVerified = false;
      await this.#writeBrowserState({
        schema: INTEGRATION_STATE_SCHEMA,
        dependencyState,
        extensionState: extensionFilesCurrent ? "prepared" : "failed",
        doctorState: "failed",
        detail: boundedError(error),
        ...(previous?.preparedAt === undefined ? {} : { preparedAt: previous.preparedAt }),
        ...(previous?.registry === undefined ? {} : { registry: previous.registry }),
        ...(previous?.extensionPreparedAt === undefined ? {} : { extensionPreparedAt: previous.extensionPreparedAt }),
        checkedAt: now,
        extensionCheckedAt: now
      });
    }
    return this.#snapshotUnlocked();
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #snapshotUnlocked(): Promise<DesktopCapabilitySnapshot> {
    let catalog: BundledCapabilityCatalog;
    try {
      catalog = parseBundledCatalog(await readBoundedJson(join(this.#capabilitiesRoot, "catalog.json")));
    } catch (error) {
      return emptyCapabilitySnapshot(boundedError(error));
    }
    let state: ManagedCapabilityState | undefined;
    try {
      state = parseManagedState(await readBoundedJson(join(this.#managedRoot, "state.json")));
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        return {
          ...snapshotFromCatalog(catalog, undefined, await this.#browserStatus(catalog)),
          phase: "error",
          detail: boundedError(error)
        };
      }
    }
    const browser = await this.#browserStatus(catalog);
    const snapshot = snapshotFromCatalog(catalog, state, browser);
    if (!state) return { ...snapshot, phase: "initializing", detail: "Agent Host 正在准备内置能力。" };
    const allInstalled = snapshot.packages.every((entry) => entry.installed);
    return {
      ...snapshot,
      phase: state.catalogVersion === catalog.catalogVersion && allInstalled ? "ready" : "degraded",
      ...(state.catalogVersion === catalog.catalogVersion && allInstalled
        ? {}
        : { detail: "内置能力版本或本地副本尚未完全就绪。" })
    };
  }

  #browserStatus(catalog?: BundledCapabilityCatalog) {
    return readBrowser67IntegrationStatus({
      stateStore: this.#browserState,
      packageRoot: this.#browserPackageRoot(),
      ...(catalog === undefined ? {} : { catalog }),
      liveIdentityVerified: this.#liveIdentityVerified,
      availableBrowsers: this.#availableBrowsers
    });
  }

  async #readBrowserState(): Promise<Browser67IntegrationState | undefined> {
    try {
      return await this.#browserState.read();
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  async #requireBrowser67Package(): Promise<string> {
    const packageRoot = this.#browserPackageRoot();
    const metadata = await lstat(packageRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("browser67 managed package is unavailable.");
    return packageRoot;
  }

  #browserPackageRoot(): string {
    return this.#browser67PackageRoots.find((root) => existsSync(root))
      ?? this.#browser67PackageRoots[0]!;
  }

  async #writeBrowserState(state: Browser67IntegrationState): Promise<void> {
    const previous = await this.#readBrowserState();
    await this.#browserState.write({
      ...state,
      ...(state.verifiedAt !== undefined
        ? { verifiedAt: state.verifiedAt }
        : previous?.verifiedAt === undefined ? {} : { verifiedAt: previous.verifiedAt }),
      ...(state.verifiedPackageIdentity !== undefined
        ? { verifiedPackageIdentity: state.verifiedPackageIdentity }
        : previous?.verifiedPackageIdentity === undefined
          ? {}
          : { verifiedPackageIdentity: previous.verifiedPackageIdentity })
    });
  }
}
