import type { DesktopIntegrationStatus } from "@pi67/protocol";
import type { Browser67IntegrationStateStore } from "./browser67-integration-state-store.js";
import { browser67DependenciesPrepared } from "./browser67-capability-process.js";
import type { Browser67BrowserId } from "./browser67-integration.js";
import {
  boundedError,
  isNodeError,
  type Browser67IntegrationState,
  type BundledCapabilityCatalog
} from "./desktop-capability-contract.js";

export async function readBrowser67IntegrationStatus(options: {
  stateStore: Browser67IntegrationStateStore;
  packageRoot: string;
  catalog?: BundledCapabilityCatalog;
  liveIdentityVerified: boolean;
  availableBrowsers: () => Browser67BrowserId[];
}): Promise<DesktopIntegrationStatus> {
  let state: Browser67IntegrationState | undefined;
  try {
    state = await options.stateStore.read();
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      return {
        id: "browser67",
        displayName: "browser67",
        bundled: true,
        dependencyState: "failed",
        extensionState: "failed",
        doctorState: "failed",
        verificationState: "never",
        availableBrowsers: options.availableBrowsers(),
        detail: boundedError(error)
      };
    }
  }
  const prepared = browser67DependenciesPrepared(options.packageRoot);
  const currentIdentity = options.catalog === undefined
    ? undefined
    : browser67PackageIdentity(options.catalog);
  const verificationState = state?.verifiedPackageIdentity === undefined
    ? state?.extensionState === "connected" && state.doctorState === "ready"
      ? "stale" as const
      : "never" as const
    : state.verifiedPackageIdentity === currentIdentity
      ? "verified" as const
      : "stale" as const;
  const persistedConnected = state?.extensionState === "connected";
  const extensionState = persistedConnected && !options.liveIdentityVerified
    ? "prepared" as const
    : state?.extensionState ?? "not-prepared";
  const doctorState = persistedConnected && !options.liveIdentityVerified
    ? "degraded" as const
    : prepared ? state?.doctorState ?? "not-checked" : "not-checked";
  return {
    id: "browser67",
    displayName: "browser67",
    bundled: true,
    dependencyState: prepared ? "prepared" : state?.dependencyState ?? "not-prepared",
    extensionState,
    doctorState,
    verificationState,
    availableBrowsers: options.availableBrowsers(),
    ...(persistedConnected && !options.liveIdentityVerified
      ? { detail: verificationState === "verified"
        ? "当前内置 browser67 与上次验证身份一致；正在确认本次应用进程中的真实连接。"
        : "扩展曾通过身份验证；正在确认当前内置版本与本次应用进程连接。" }
      : state?.detail === undefined ? {} : { detail: state.detail }),
    ...(state?.preparedAt === undefined ? {} : { preparedAt: state.preparedAt }),
    ...(state?.checkedAt === undefined ? {} : { checkedAt: state.checkedAt }),
    ...(state?.extensionPreparedAt === undefined ? {} : { extensionPreparedAt: state.extensionPreparedAt }),
    ...(state?.extensionCheckedAt === undefined ? {} : { extensionCheckedAt: state.extensionCheckedAt }),
    ...(state?.verifiedAt === undefined ? {} : { verifiedAt: state.verifiedAt }),
    ...(state?.registry === undefined ? {} : { registry: state.registry })
  };
}

export function browser67PackageIdentity(catalog: BundledCapabilityCatalog): string | undefined {
  const entry = catalog.entries.find((candidate) => candidate.id === "browser67");
  return entry?.commit === undefined ? undefined : `${entry.version}:${entry.commit}`;
}
