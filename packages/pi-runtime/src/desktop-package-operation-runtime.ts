import {
  DefaultPackageManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionPackageMutationResult,
  ExtensionPackageScope,
  ExtensionPackageUpdatesResult
} from "@pi67/domain";
import { ExtensionPackageManagement } from "./extension-package-management.js";

export interface DesktopPackageOperationRuntime {
  applyNpmCommand(command: string[]): void;
  configuredPackages(): Array<{ source: string; installedPath?: string }>;
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
  const packageManager = new DefaultPackageManager({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager
  });
  const management = new ExtensionPackageManagement({
    settingsManager,
    packageManager
  });
  return {
    applyNpmCommand(command) {
      settingsManager.applyOverrides({ npmCommand: [...command] });
    },
    configuredPackages() {
      return packageManager.listConfiguredPackages().map(({ source, installedPath }) => ({
        source,
        ...(installedPath === undefined ? {} : { installedPath })
      }));
    },
    checkForUpdates: () => management.checkForUpdates(),
    install: (source, scope) => management.install(source, scope),
    update: (source, scope) => management.update(source, scope),
    uninstall: (source, scope) => management.uninstall(source, scope)
  };
}
