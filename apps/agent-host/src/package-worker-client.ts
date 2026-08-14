import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionPackageMutationResult } from "@pi67/domain";
import {
  ExtensionPackageManagement,
  reloadDesktopSettings,
  resolveDesktopPackageToolchain,
  type PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import { EXTENSION_PACKAGE_WORKER_TIMEOUT_MS } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import type { ExtensionPackageManagementPort } from "./extension-package-command-router.js";
import {
  isCorrelatedPackageWorkerResponse,
  isPackageWorkerMessageWithinByteLimit,
  isPackageWorkerResponse,
  type PackageWorkerAction,
  type PackageWorkerRequest
} from "./package-worker-protocol.js";
import {
  createPackageWorkerProcessTreeController,
  inspectPackageWorkerProcessTree,
  terminateAndWaitForPackageWorkerProcessTree,
  terminatePackageWorkerProcessTree,
  type PackageWorkerProcessTreeController,
  type PackageWorkerProcessTreeInspector,
  type PackageWorkerProcessTreeTerminator
} from "./package-worker-process-tree.js";
import {
  invalidPackageWorkerResult,
  parsePackageWorkerMutationResult,
  parsePackageWorkerUpdatesResult
} from "./package-worker-result.js";

export type {
  PackageWorkerProcessTreeController,
  PackageWorkerProcessTreeTerminator
} from "./package-worker-process-tree.js";

const packageWorkerEntry = fileURLToPath(new URL("./package-worker.mjs", import.meta.url));
const DEFAULT_PACKAGE_WORKER_TERMINATION_GRACE_MS = 4_000;
const MIN_PACKAGE_WORKER_TERMINATION_GRACE_MS = 20;
const MAX_PACKAGE_WORKER_TERMINATION_GRACE_MS = 5_000;
const PACKAGE_WORKER_ENVIRONMENT_KEYS = [
  "APPDATA",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LOCALAPPDATA",
  "LOGNAME",
  "PATH",
  "PATHEXT",
  "PI_OFFLINE",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "WINDIR"
] as const;
const PACKAGE_WORKER_LOCALE_ENVIRONMENT_KEYS = [
  "LC_ALL",
  "LC_COLLATE",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_MONETARY",
  "LC_NUMERIC",
  "LC_TIME"
] as const;

export interface PackageWorkerClientOptions {
  workerEntry?: string;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  terminationGraceMs?: number;
  platform?: NodeJS.Platform;
  spawnWorker?: (executable: string, arguments_: string[], options: Parameters<typeof spawn>[2]) => ChildProcess;
  createProcessTreeController?: () => PackageWorkerProcessTreeController;
  terminateProcessTree?: PackageWorkerProcessTreeTerminator;
  inspectProcessTree?: PackageWorkerProcessTreeInspector;
}

export interface PackageWorkerPort {
  run(
    action: PackageWorkerAction,
    services: PiWorkspaceRuntimeServices,
    target?: { source: string; scope: "global" | "project" }
  ): Promise<unknown>;
  shutdown?(deadlineMs?: number): Promise<void>;
}

interface ActivePackageWorker {
  cancel(deadlineMs: number): void;
  done: Promise<unknown>;
}

export class PackageWorkerClient implements PackageWorkerPort {
  readonly #workerEntry: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #timeoutMs: number;
  readonly #terminationGraceMs: number;
  readonly #platform: NodeJS.Platform;
  readonly #spawnWorker: NonNullable<PackageWorkerClientOptions["spawnWorker"]>;
  readonly #createProcessTreeController: () => PackageWorkerProcessTreeController;
  readonly #activeWorkers = new Set<ActivePackageWorker>();
  #shuttingDown = false;
  #shutdownPromise: Promise<void> | undefined;

  constructor(options: PackageWorkerClientOptions = {}) {
    this.#workerEntry = options.workerEntry ?? packageWorkerEntry;
    this.#environment = options.environment ?? process.env;
    this.#timeoutMs = options.timeoutMs ?? EXTENSION_PACKAGE_WORKER_TIMEOUT_MS;
    this.#terminationGraceMs = options.terminationGraceMs ?? DEFAULT_PACKAGE_WORKER_TERMINATION_GRACE_MS;
    this.#platform = options.platform ?? process.platform;
    this.#spawnWorker = options.spawnWorker ?? spawn;
    this.#createProcessTreeController = options.createProcessTreeController ?? (
      options.terminateProcessTree || options.inspectProcessTree
        ? () => ({
            attach: async () => undefined,
            terminate: options.terminateProcessTree ?? terminatePackageWorkerProcessTree,
            inspect: options.inspectProcessTree ?? inspectPackageWorkerProcessTree,
            dispose: async () => undefined
          })
        : () => createPackageWorkerProcessTreeController(this.#platform, this.#environment)
    );
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 10 * 60_000) {
      throw new RangeError("Package worker timeout must be between 1000 and 600000 milliseconds.");
    }
    if (
      !Number.isSafeInteger(this.#terminationGraceMs)
      || this.#terminationGraceMs < MIN_PACKAGE_WORKER_TERMINATION_GRACE_MS
      || this.#terminationGraceMs > MAX_PACKAGE_WORKER_TERMINATION_GRACE_MS
    ) {
      throw new RangeError("Package worker termination grace must be between 20 and 5000 milliseconds.");
    }
  }

  run(
    action: PackageWorkerAction,
    services: PiWorkspaceRuntimeServices,
    target?: { source: string; scope: "global" | "project" }
  ): Promise<unknown> {
    if (this.#shuttingDown) return Promise.reject(packageWorkerShuttingDown());
    const toolchain = resolveDesktopPackageToolchain(this.#environment);
    if (
      !toolchain.desktop
      || !toolchain.ready
      || !toolchain.root
      || !toolchain.electronExecutable
      || !toolchain.nodeExecutable
      || !toolchain.npmCli
      || !toolchain.gitExecutable
      || !toolchain.gitExecPath
    ) {
      return Promise.reject(new HostCommandError(
        "TOOLCHAIN_MISSING",
        "Pi-67 Desktop private Node/npm/Git toolchain is unavailable.",
        false
      ));
    }
    const request: PackageWorkerRequest = {
      type: "package-worker-request",
      requestId: randomUUID(),
      action,
      cwd: services.cwd,
      agentDir: services.agentDir,
      projectTrusted: services.settingsManager.isProjectTrusted(),
      ...(toolchain.networkSettingsPath === undefined
        ? {}
        : { networkSettingsPath: toolchain.networkSettingsPath }),
      ...(target === undefined ? {} : target)
    };
    return this.#execute(
      toolchain.electronExecutable,
      request,
      packageWorkerEnvironment(this.#environment, toolchain)
    );
  }

  shutdown(deadlineMs = this.#terminationGraceMs): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    if (
      !Number.isSafeInteger(deadlineMs)
      || deadlineMs < MIN_PACKAGE_WORKER_TERMINATION_GRACE_MS
      || deadlineMs > 10_000
    ) {
      return Promise.reject(new RangeError("Package worker shutdown deadline must be between 20 and 10000 milliseconds."));
    }
    this.#shuttingDown = true;
    const activeWorkers = [...this.#activeWorkers];
    for (const worker of activeWorkers) worker.cancel(deadlineMs);
    this.#shutdownPromise = Promise.all(activeWorkers.map((worker) => worker.done)).then((errors) => {
      const error = errors.find((value) => value !== undefined);
      if (error !== undefined) throw error;
    });
    return this.#shutdownPromise;
  }

  #execute(
    executable: string,
    request: PackageWorkerRequest,
    environment: NodeJS.ProcessEnv
  ): Promise<unknown> {
    return new Promise((resolvePromise, reject) => {
      let child: ChildProcess;
      try {
        child = this.#spawnWorker(executable, [this.#workerEntry], {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          env: environment,
          detached: this.#platform !== "win32",
          windowsHide: true
        });
      } catch (error) {
        reject(packageWorkerStartFailure(error));
        return;
      }
      const processTree = this.#createProcessTreeController();

      let finalizing = false;
      let timer: NodeJS.Timeout | undefined;
      let resolveExited!: () => void;
      let resolveDone!: (error: unknown) => void;
      const exited = new Promise<void>((resolve) => { resolveExited = resolve; });
      const activeWorker: ActivePackageWorker = {
        cancel: (deadlineMs) => finish(() => reject(packageWorkerShuttingDown()), deadlineMs),
        done: new Promise((resolve) => { resolveDone = resolve; })
      };
      this.#activeWorkers.add(activeWorker);

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        child.removeAllListeners();
        if (child.connected) {
          try {
            child.disconnect();
          } catch {
            // The process exit listener remains the authority for cleanup completion.
          }
        }
      };
      const finish = (operation: () => void, deadlineMs = this.#terminationGraceMs): void => {
        if (finalizing) return;
        finalizing = true;
        if (timer) clearTimeout(timer);
        void terminateAndWaitForPackageWorkerProcessTree(
          child,
          exited,
          deadlineMs,
          this.#platform,
          this.#environment,
          processTree.terminate,
          processTree.inspect
        )
          .then(async () => {
            await processTree.dispose();
            operation();
            resolveDone(undefined);
          })
          .catch(async (error: unknown) => {
            await processTree.dispose().catch(() => undefined);
            reject(error);
            resolveDone(error);
          })
          .finally(() => {
            cleanup();
            this.#activeWorkers.delete(activeWorker);
          });
      };

      child.once("error", (error) => {
        if (child.pid === undefined) resolveExited();
        finish(() => reject(packageWorkerStartFailure(error)));
      });
      child.once("exit", (code, signal) => {
        resolveExited();
        finish(() => reject(new HostCommandError(
          "INTERNAL",
          `The isolated Pi package worker exited before responding (${signal ?? code}).`,
          true
        )));
      });
      child.on("message", (message: unknown) => {
        if (!isCorrelatedPackageWorkerResponse(message, request.requestId)) return;
        if (!isPackageWorkerMessageWithinByteLimit(message)) {
          finish(() => reject(new HostCommandError(
            "RESOURCE_LIMIT_EXCEEDED",
            "The isolated Pi package worker result exceeded the IPC byte limit.",
            false
          )));
          return;
        }
        if (!isPackageWorkerResponse(message, request.requestId)) {
          finish(() => reject(invalidPackageWorkerResult()));
          return;
        }
        if (!message.ok) {
          finish(() => reject(new HostCommandError(
            message.error.code,
            message.error.message,
            message.error.recoverable,
            message.error.details
          )));
          return;
        }
        finish(() => resolvePromise(message.result));
      });
      void processTree.attach(child).then(() => {
        if (finalizing) return;
        timer = setTimeout(() => finish(() => reject(new HostCommandError(
          "REQUEST_TIMEOUT",
          "The isolated Pi package operation timed out.",
          true
        ))), this.#timeoutMs);
        timer.unref?.();
        if (!child.send) {
          finish(() => reject(packageWorkerConnectionClosed()));
          return;
        }
        try {
          child.send(request, (error) => {
            if (error) finish(() => reject(new HostCommandError(
              "CONNECTION_CLOSED",
              "The isolated Pi package worker request could not be delivered.",
              true
            )));
          });
        } catch {
          finish(() => reject(packageWorkerConnectionClosed()));
        }
      }).catch((error: unknown) => {
        finish(() => reject(error));
      });
    });
  }

}

function packageWorkerEnvironment(
  source: NodeJS.ProcessEnv,
  toolchain: ReturnType<typeof resolveDesktopPackageToolchain>
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of PACKAGE_WORKER_ENVIRONMENT_KEYS) copyEnvironmentValue(source, environment, key);
  for (const key of PACKAGE_WORKER_LOCALE_ENVIRONMENT_KEYS) copyEnvironmentValue(source, environment, key);
  Object.assign(environment, {
    ELECTRON_RUN_AS_NODE: "1",
    PI_TELEMETRY: "0",
    PI67_DESKTOP: "1",
    PI67_PACKAGED: toolchain.packaged ? "1" : "0",
    PI67_TOOLCHAIN_ROOT: toolchain.root,
    PI67_NODE_EXECUTABLE: toolchain.nodeExecutable,
    PI67_NPM_CLI: toolchain.npmCli,
    PI67_GIT_EXECUTABLE: toolchain.gitExecutable,
    PI67_GIT_EXEC_PATH: toolchain.gitExecPath
  });
  if (toolchain.networkSettingsPath) {
    environment.PI67_PACKAGE_NETWORK_SETTINGS = toolchain.networkSettingsPath;
  }
  return environment;
}

function copyEnvironmentValue(
  source: NodeJS.ProcessEnv,
  destination: NodeJS.ProcessEnv,
  key: string
): void {
  const value = source[key];
  if (typeof value === "string") destination[key] = value;
}

function packageWorkerStartFailure(error: unknown): HostCommandError {
  return new HostCommandError(
    "INTERNAL",
    `The isolated Pi package worker could not start: ${error instanceof Error ? error.message : "unknown error"}`,
    true
  );
}

function packageWorkerConnectionClosed(): HostCommandError {
  return new HostCommandError(
    "CONNECTION_CLOSED",
    "The isolated Pi package worker request could not be delivered.",
    true
  );
}

function packageWorkerShuttingDown(): HostCommandError {
  return new HostCommandError(
    "CONNECTION_CLOSED",
    "The isolated Pi package worker is shutting down.",
    true,
    { shuttingDown: true }
  );
}

export function createWorkerBackedExtensionPackageManagement(
  services: PiWorkspaceRuntimeServices,
  worker: PackageWorkerPort = new PackageWorkerClient()
): ExtensionPackageManagementPort {
  const local = new ExtensionPackageManagement({
    packageManager: services.packageManager,
    settingsManager: services.settingsManager
  }, services.packageTrustRegistry);
  return {
    list: () => local.list(),
    checkForUpdates: async () => parsePackageWorkerUpdatesResult(await worker.run("check-updates", services)),
    install: async (source, scope) => mutateWithWorker("install", source, scope),
    update: async (source, scope) => mutateWithWorker("update", source, scope),
    setEnabled: (source, scope, enabled, resourceType) => local.setEnabled(source, scope, enabled, resourceType),
    restoreProjectInheritance: (source) => local.restoreProjectInheritance(source),
    uninstall: async (source, scope) => mutateWithWorker("uninstall", source, scope)
  };

  async function mutateWithWorker(
    action: "install" | "update" | "uninstall",
    source: string,
    scope: "global" | "project"
  ): Promise<ExtensionPackageMutationResult> {
    const result = parsePackageWorkerMutationResult(await worker.run(action, services, { source, scope }));
    await reloadDesktopSettings(services.settingsManager);
    const current = local.list();
    return { ...current, changed: result.changed };
  }
}
