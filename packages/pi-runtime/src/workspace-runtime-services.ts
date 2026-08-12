import { resolve } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type { PiConfigurationService } from "./pi-configuration-service.js";
import type { RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import { installDesktopPackageToolchainReloadHook } from "./desktop-package-toolchain.js";
import { createRuntimeSessionCatalogOwner, type RuntimeSessionCatalogOwner } from "./runtime-session-catalog.js";
import {
  normalizeSessionCatalogPathIdentity,
  normalizeSessionCatalogWorkspaceIdentity
} from "./session-path-identity.js";
import { SessionCreationReceiptStore } from "./session-creation-receipt-store.js";
import { PackageMutationReceiptStore } from "./package-mutation-receipt-store.js";
import { PackageTrustRegistry } from "./package-trust-registry.js";
import { ExtensionPackageOnboardingStore } from "./extension-package-onboarding-store.js";
import {
  createPiWorkspaceProviderCatalog,
  type PiWorkspaceProviderCatalog
} from "./workspace-provider-catalog.js";

export interface CreatePiWorkspaceRuntimeServicesOptions {
  cwd: string;
  agentDir: string;
  projectTrusted?: boolean;
  settingsManager?: SettingsManager;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  configurationService?: PiConfigurationService;
  sessionCatalogDirectory?: string;
  storageRoot?: string;
  sessionCatalogOwner?: RuntimeSessionCatalogOwner;
}

export interface PiWorkspaceRuntimeServices {
  readonly cwd: string;
  readonly agentDir: string;
  readonly settingsManager: SettingsManager;
  /** Official Pi package mutation coordinator; ResourceLoader instances remain Task-local. */
  readonly packageManager: DefaultPackageManager;
  readonly providerCatalog: PiWorkspaceProviderCatalog;
  readonly configurationService?: PiConfigurationService;
  readonly sessionCatalog: RuntimeSessionCatalogOwner;
  readonly sessionCreationReceipts: SessionCreationReceiptStore;
  readonly packageMutationReceipts: PackageMutationReceiptStore;
  readonly packageTrustRegistry: PackageTrustRegistry;
  readonly packageOnboarding: ExtensionPackageOnboardingStore;
  assertCompatible(cwd: string, agentDir: string): void;
  setProjectTrusted(trusted: boolean): void;
  dispose(): Promise<void>;
}

export function createPiWorkspaceRuntimeServices(
  options: CreatePiWorkspaceRuntimeServicesOptions
): PiWorkspaceRuntimeServices {
  const cwd = resolve(options.cwd);
  const agentDir = resolve(options.agentDir);
  const cwdIdentity = normalizeSessionCatalogWorkspaceIdentity(cwd);
  const agentDirIdentity = normalizeSessionCatalogPathIdentity(agentDir);
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir, {
    projectTrusted: options.projectTrusted ?? false
  });
  settingsManager.setProjectTrusted(options.projectTrusted ?? settingsManager.isProjectTrusted());
  const releaseDesktopReloadHook = installDesktopPackageToolchainReloadHook(settingsManager);
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const providerCatalog = createPiWorkspaceProviderCatalog({
    cwd,
    agentDir,
    settingsManager,
    ...(options.runtimeCredentialOverrides === undefined
      ? {}
      : { runtimeCredentialOverrides: options.runtimeCredentialOverrides })
  });
  const ownsSessionCatalog = options.sessionCatalogOwner === undefined;
  const sessionCatalog = options.sessionCatalogOwner ?? createRuntimeSessionCatalogOwner(
    options.sessionCatalogDirectory,
    options.storageRoot
  );
  const sessionCreationReceipts = new SessionCreationReceiptStore({
    cwd,
    agentDir,
    getConfiguredSessionDir: () => settingsManager.getSessionDir(),
    ...(options.storageRoot === undefined ? {} : { storageRoot: options.storageRoot })
  });
  const packageMutationReceipts = new PackageMutationReceiptStore({
    cwd,
    agentDir,
    ...(options.storageRoot === undefined ? {} : { storageRoot: options.storageRoot })
  });
  const packageTrustRegistry = new PackageTrustRegistry({
    packageManager,
    settingsManager,
    receipts: packageMutationReceipts
  });
  const packageOnboarding = sharedPackageOnboardingStore(
    agentDir,
    options.storageRoot,
    process.env.PI67_AGENT_PROFILE_FRESH === "1"
  );
  const unregisterConfiguration = options.configurationService?.registerWorkspace({
    cwd,
    settingsManager,
    projectTrusted: options.projectTrusted ?? settingsManager.isProjectTrusted()
  });
  let disposed = false;

  return {
    cwd,
    agentDir,
    settingsManager,
    packageManager,
    providerCatalog,
    ...(options.configurationService === undefined
      ? {}
      : { configurationService: options.configurationService }),
    sessionCatalog,
    sessionCreationReceipts,
    packageMutationReceipts,
    packageTrustRegistry,
    packageOnboarding,
    assertCompatible(candidateCwd, candidateAgentDir) {
      if (
        normalizeSessionCatalogWorkspaceIdentity(candidateCwd) !== cwdIdentity
        || normalizeSessionCatalogPathIdentity(candidateAgentDir) !== agentDirIdentity
      ) {
        throw new RuntimeError(
          "INVALID_PAYLOAD",
          "The Pi runtime does not match its Workspace service boundary."
        );
      }
    },
    setProjectTrusted(trusted) {
      settingsManager.setProjectTrusted(trusted);
      options.configurationService?.setProjectTrusted(cwd, trusted);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await providerCatalog.dispose();
      } finally {
        try {
          await settingsManager.flush();
        } finally {
          try {
            if (ownsSessionCatalog) {
              await sessionCatalog.dispose();
            }
          } finally {
            unregisterConfiguration?.();
            releaseDesktopReloadHook();
          }
        }
      }
    }
  };
}

const packageOnboardingStores = new Map<string, ExtensionPackageOnboardingStore>();

function sharedPackageOnboardingStore(
  agentDir: string,
  storageRoot: string | undefined,
  freshProfile: boolean
): ExtensionPackageOnboardingStore {
  const key = `${storageRoot === undefined ? "volatile" : resolve(storageRoot)}\0${agentDir}`;
  const existing = packageOnboardingStores.get(key);
  if (existing) return existing;
  const store = new ExtensionPackageOnboardingStore({
    ...(storageRoot === undefined ? {} : { storageRoot }),
    freshProfile
  });
  packageOnboardingStores.set(key, store);
  return store;
}

export function createInMemoryPiWorkspaceRuntimeServices(
  options: Omit<CreatePiWorkspaceRuntimeServicesOptions, "settingsManager">
): PiWorkspaceRuntimeServices {
  return createPiWorkspaceRuntimeServices({
    ...options,
    settingsManager: SettingsManager.inMemory()
  });
}
