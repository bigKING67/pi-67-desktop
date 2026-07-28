import {
  DefaultPackageManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type { PiConfigurationService } from "./pi-configuration-service.js";
import type { RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import { createRuntimeSessionCatalogOwner, type RuntimeSessionCatalogOwner } from "./runtime-session-catalog.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";
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
  assertCompatible(cwd: string, agentDir: string): void;
  setProjectTrusted(trusted: boolean): void;
  dispose(): Promise<void>;
}

export function createPiWorkspaceRuntimeServices(
  options: CreatePiWorkspaceRuntimeServicesOptions
): PiWorkspaceRuntimeServices {
  const cwd = normalizeSessionCatalogPathIdentity(options.cwd);
  const agentDir = normalizeSessionCatalogPathIdentity(options.agentDir);
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir, {
    projectTrusted: options.projectTrusted ?? false
  });
  settingsManager.setProjectTrusted(options.projectTrusted ?? settingsManager.isProjectTrusted());
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const providerCatalog = createPiWorkspaceProviderCatalog({
    cwd,
    agentDir,
    settingsManager,
    ...(options.runtimeCredentialOverrides === undefined
      ? {}
      : { runtimeCredentialOverrides: options.runtimeCredentialOverrides })
  });
  const sessionCatalog = createRuntimeSessionCatalogOwner(
    options.sessionCatalogDirectory,
    options.storageRoot
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
    assertCompatible(candidateCwd, candidateAgentDir) {
      if (
        normalizeSessionCatalogPathIdentity(candidateCwd) !== cwd
        || normalizeSessionCatalogPathIdentity(candidateAgentDir) !== agentDir
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
            await sessionCatalog.dispose();
          } finally {
            unregisterConfiguration?.();
          }
        }
      }
    }
  };
}
