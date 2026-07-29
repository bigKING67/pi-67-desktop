import {
  DefaultPackageManager,
  SettingsManager,
  type PackageSource
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionPackageMutationResult,
  ExtensionPackageScope,
  ExtensionPackageUpdatesResult
} from "@pi67/domain";
import { ExtensionPackageManagement } from "./extension-package-management.js";

export interface DesktopPackageOperationRuntime {
  applyNpmCommand(command: string[]): void;
  configuredSources(): string[];
  checkForUpdates(): Promise<ExtensionPackageUpdatesResult>;
  install(source: string, scope: ExtensionPackageScope): Promise<ExtensionPackageMutationResult>;
  update(source: string, scope: ExtensionPackageScope): Promise<ExtensionPackageMutationResult>;
  uninstall(source: string, scope: ExtensionPackageScope): Promise<ExtensionPackageMutationResult>;
}

export function createDesktopPackageOperationRuntime(options: {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}): DesktopPackageOperationRuntime {
  const settingsManager = SettingsManager.create(options.cwd, options.agentDir, {
    projectTrusted: options.projectTrusted
  });
  settingsManager.setProjectTrusted(options.projectTrusted);
  const management = new ExtensionPackageManagement({
    settingsManager,
    packageManager: new DefaultPackageManager({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager
    })
  });
  return {
    applyNpmCommand(command) {
      settingsManager.applyOverrides({ npmCommand: [...command] });
    },
    configuredSources() {
      return [
        ...(settingsManager.getGlobalSettings().packages ?? []),
        ...(settingsManager.getProjectSettings().packages ?? [])
      ].map(packageSource);
    },
    checkForUpdates: () => management.checkForUpdates(),
    install: (source, scope) => management.install(source, scope),
    update: (source, scope) => management.update(source, scope),
    uninstall: (source, scope) => management.uninstall(source, scope)
  };
}

function packageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}
