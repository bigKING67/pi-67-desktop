import type { ExtensionPackageListResult, ExtensionPackageMutationResult } from "@pi67/domain";
import type { AgentRuntime, PiWorkspaceRuntimeServices } from "@pi67/pi-runtime";
import type { AgentCommand, WorkspaceProtocolContext } from "@pi67/protocol";
import { vi } from "vitest";
import {
  ExtensionPackageCommandRouter,
  type ExtensionPackageCommandType,
  type ExtensionPackageTaskView
} from "./extension-package-command-router.js";

export const WORKSPACE_A: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-a"
};
export const EMPTY_LIST: ExtensionPackageListResult = { items: [], total: 0 };
export const MUTATED_LIST: ExtensionPackageMutationResult = {
  items: [],
  total: 0,
  changed: true
};

export function createRouter(
  overrides: Partial<ReturnType<typeof management>> = {},
  tasks: ExtensionPackageTaskView[] = [],
  services: PiWorkspaceRuntimeServices = workspaceServices()
): ExtensionPackageCommandRouter {
  const packages = management(overrides);
  return new ExtensionPackageCommandRouter({
    getWorkspaceServices: () => services,
    listTasks: () => tasks,
    createManagement: () => packages
  });
}

export function workspaceServices(
  receiptOverrides: Record<string, unknown> = {},
  trustOverrides: Record<string, unknown> = {},
  onboardingOverrides: Record<string, unknown> = {}
): PiWorkspaceRuntimeServices {
  return {
    packageMutationReceipts: {
      reserve: vi.fn(async () => ({ status: "reserved", record: {} })),
      markMutating: vi.fn(async () => undefined),
      commitActive: vi.fn(async () => undefined),
      commitRemoved: vi.fn(async () => undefined),
      markAmbiguous: vi.fn(async () => undefined),
      refreshActiveObservation: vi.fn(async () => false),
      ...receiptOverrides
    },
    packageTrustRegistry: {
      refresh: vi.fn(async () => undefined),
      observationFor: vi.fn(() => ({ status: "observed", observation: observedPackage() })),
      ...trustOverrides
    },
    packageOnboarding: {
      status: vi.fn(async (source: string, scope: "global" | "project") => ({
        source,
        scope,
        state: "suppressed-existing" as const
      })),
      decline: vi.fn(async (source: string, scope: "global" | "project") => ({
        source,
        scope,
        state: "declined" as const
      })),
      markInstalling: vi.fn(async () => undefined),
      markInstalled: vi.fn(async () => undefined),
      markInstallFailed: vi.fn(async () => undefined),
      ...onboardingOverrides
    }
  } as unknown as PiWorkspaceRuntimeServices;
}

export function observedPackage() {
  return {
    manifestSha256: "1".repeat(64),
    contentSha256: "2".repeat(64),
    directoryIdentityDigest: "3".repeat(64),
    observedAt: 1
  };
}

function management(overrides: Partial<{
  list: () => typeof EMPTY_LIST;
  checkForUpdates: () => Promise<{ items: never[]; total: number }>;
  install: (source: string, scope: "global" | "project") => Promise<typeof MUTATED_LIST>;
  update: (source: string, scope: "global" | "project") => Promise<typeof MUTATED_LIST>;
  setEnabled: (
    source: string,
    scope: "global" | "project",
    enabled: boolean
  ) => Promise<typeof MUTATED_LIST>;
  restoreProjectInheritance: (source: string) => Promise<typeof MUTATED_LIST>;
  uninstall: (source: string, scope: "global" | "project") => Promise<typeof MUTATED_LIST>;
}> = {}) {
  return {
    list: () => EMPTY_LIST,
    checkForUpdates: async () => ({ items: [], total: 0 }),
    install: async () => MUTATED_LIST,
    update: async () => MUTATED_LIST,
    setEnabled: async () => MUTATED_LIST,
    restoreProjectInheritance: async () => MUTATED_LIST,
    uninstall: async () => MUTATED_LIST,
    ...overrides
  };
}

export function task(
  workspaceId: string,
  idle: boolean,
  activeRuntime: AgentRuntime = runtime().runtime
): ExtensionPackageTaskView {
  return {
    taskKey: `${workspaceId}:task`,
    workspaceId,
    runtime: activeRuntime,
    initialized: true,
    isIdle: () => idle
  };
}

export function runtime(reloadError?: Error): {
  runtime: AgentRuntime;
  reloadResources: ReturnType<typeof vi.fn<AgentRuntime["reloadResources"]>>;
} {
  const reloadResources = vi.fn<AgentRuntime["reloadResources"]>(async () => {
    if (reloadError) throw reloadError;
    return {
      sessionId: "session-a",
      controls: { thinkingLevel: "off" },
      modelCatalog: { models: [], providers: [], availableThinkingLevels: [] },
      resources: []
    };
  });
  return {
    runtime: { reloadResources } as unknown as AgentRuntime,
    reloadResources
  };
}

export function command<T extends ExtensionPackageCommandType>(
  type: T,
  payload: AgentCommand<T>["payload"]
): AgentCommand<T> {
  return { type, payload } as AgentCommand<T>;
}
