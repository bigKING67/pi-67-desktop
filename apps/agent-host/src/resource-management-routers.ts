import {
  createContextFileManagement,
  type ContextFileManagementPort,
  type PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import { ContextFileCommandRouter } from "./context-file-command-router.js";
import {
  ExtensionPackageCommandRouter,
  type ExtensionPackageManagementPort
} from "./extension-package-command-router.js";
import {
  PackageWorkerClient,
  createWorkerBackedExtensionPackageManagement,
  type PackageWorkerPort
} from "./package-worker-client.js";
import {
  ResourceManagementCoordinator,
  type ResourceManagementTaskView
} from "./resource-management-coordinator.js";
import { SkillPackCommandRouter } from "./skill-pack-command-router.js";
import {
  createSkillPackManagement,
  type SkillPackManagementPort
} from "./skill-pack-management.js";

export type ExtensionPackageManagementFactory = (
  services: PiWorkspaceRuntimeServices
) => ExtensionPackageManagementPort;

export type SkillPackManagementFactory = (
  services: PiWorkspaceRuntimeServices
) => SkillPackManagementPort;

export type ContextFileManagementFactory = (
  services: PiWorkspaceRuntimeServices
) => ContextFileManagementPort;

interface ResourceManagementRouterOptions {
  getWorkspaceServices(workspaceId: string): PiWorkspaceRuntimeServices;
  listTasks(): ResourceManagementTaskView[];
  extensionPackageManagementFactory?: ExtensionPackageManagementFactory;
  packageWorker?: PackageWorkerPort;
  skillPackManagementFactory?: SkillPackManagementFactory;
  contextFileManagementFactory?: ContextFileManagementFactory;
}

export interface ResourceManagementRouters {
  extensionPackages: ExtensionPackageCommandRouter;
  skillPacks: SkillPackCommandRouter;
  contextFiles: ContextFileCommandRouter;
  shutdown(deadlineMs?: number): Promise<void>;
}

export function createResourceManagementRouters(
  options: ResourceManagementRouterOptions
): ResourceManagementRouters {
  const coordinator = new ResourceManagementCoordinator({ listTasks: () => options.listTasks() });
  const packageWorker = options.extensionPackageManagementFactory === undefined
    ? options.packageWorker ?? new PackageWorkerClient()
    : undefined;
  let shutdownPromise: Promise<void> | undefined;
  return {
    contextFiles: new ContextFileCommandRouter({
      getWorkspaceServices: (workspaceId) => options.getWorkspaceServices(workspaceId),
      coordinator,
      createManagement: (services) => options.contextFileManagementFactory?.(services)
        ?? createContextFileManagement(services)
    }),
    extensionPackages: new ExtensionPackageCommandRouter({
      getWorkspaceServices: (workspaceId) => options.getWorkspaceServices(workspaceId),
      listTasks: () => options.listTasks(),
      coordinator,
      createManagement: (services) => options.extensionPackageManagementFactory?.(services)
        ?? createWorkerBackedExtensionPackageManagement(services, packageWorker!)
    }),
    skillPacks: new SkillPackCommandRouter({
      getWorkspaceServices: (workspaceId) => options.getWorkspaceServices(workspaceId),
      coordinator,
      createManagement: (services) => options.skillPackManagementFactory?.(services)
        ?? createSkillPackManagement(services)
    }),
    shutdown: (deadlineMs = 1_000) => {
      shutdownPromise ??= Promise.allSettled([
        coordinator.shutdown(deadlineMs),
        packageWorker?.shutdown?.(deadlineMs) ?? Promise.resolve()
      ]).then((results) => {
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (rejected) throw rejected.reason;
      });
      return shutdownPromise;
    }
  };
}
