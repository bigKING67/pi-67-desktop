import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  ExtensionPackageListResult,
  ExtensionPackageMutationResult,
  ExtensionPackageUpdatesResult
} from "@pi67/domain";
import {
  ExtensionPackageManagement,
  reloadDesktopSettings,
  resolveDesktopPackageToolchain,
  type PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import { HostCommandError } from "./protocol-error.js";
import type { ExtensionPackageManagementPort } from "./extension-package-command-router.js";
import {
  isPackageWorkerResponse,
  type PackageWorkerAction,
  type PackageWorkerRequest
} from "./package-worker-protocol.js";

const DEFAULT_PACKAGE_WORKER_TIMEOUT_MS = 5 * 60_000;
const packageWorkerEntry = fileURLToPath(new URL("./package-worker.mjs", import.meta.url));

export interface PackageWorkerClientOptions {
  workerEntry?: string;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  spawnWorker?: (executable: string, arguments_: string[], options: Parameters<typeof spawn>[2]) => ChildProcess;
}

export interface PackageWorkerPort {
  run(
    action: PackageWorkerAction,
    services: PiWorkspaceRuntimeServices,
    target?: { source: string; scope: "global" | "project" }
  ): Promise<unknown>;
}

export class PackageWorkerClient implements PackageWorkerPort {
  readonly #workerEntry: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #timeoutMs: number;
  readonly #spawnWorker: NonNullable<PackageWorkerClientOptions["spawnWorker"]>;

  constructor(options: PackageWorkerClientOptions = {}) {
    this.#workerEntry = options.workerEntry ?? packageWorkerEntry;
    this.#environment = options.environment ?? process.env;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_PACKAGE_WORKER_TIMEOUT_MS;
    this.#spawnWorker = options.spawnWorker ?? spawn;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 10 * 60_000) {
      throw new RangeError("Package worker timeout must be between 1000 and 600000 milliseconds.");
    }
  }

  run(
    action: PackageWorkerAction,
    services: PiWorkspaceRuntimeServices,
    target?: { source: string; scope: "global" | "project" }
  ): Promise<unknown> {
    const toolchain = resolveDesktopPackageToolchain(this.#environment);
    if (
      !toolchain.desktop
      || !toolchain.ready
      || !toolchain.electronExecutable
      || !toolchain.nodeExecutable
      || !toolchain.npmCli
      || !toolchain.gitExecutable
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
    return this.#execute(toolchain.electronExecutable, request);
  }

  #execute(executable: string, request: PackageWorkerRequest): Promise<unknown> {
    return new Promise((resolvePromise, reject) => {
      const child = this.#spawnWorker(executable, [this.#workerEntry], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          ...this.#environment,
          ELECTRON_RUN_AS_NODE: "1",
          PI_TELEMETRY: "0"
        }
      });
      let settled = false;
      const finish = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeAllListeners();
        child.stderr?.removeAllListeners();
        if (child.connected) child.disconnect();
        if (child.exitCode === null && child.signalCode === null) child.kill();
        operation();
      };
      const timer = setTimeout(() => finish(() => reject(new HostCommandError(
        "REQUEST_TIMEOUT",
        "The isolated Pi package operation timed out.",
        true
      ))), this.#timeoutMs);
      child.stderr?.on("data", () => undefined);
      child.once("error", (error) => finish(() => reject(new HostCommandError(
        "INTERNAL",
        `The isolated Pi package worker could not start: ${error.message}`,
        true
      ))));
      child.once("exit", (code, signal) => finish(() => reject(new HostCommandError(
        "INTERNAL",
        `The isolated Pi package worker exited before responding (${signal ?? code}).`,
        true
      ))));
      child.on("message", (message: unknown) => {
        if (!isPackageWorkerResponse(message, request.requestId)) return;
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
      child.send?.(request, (error) => {
        if (error) finish(() => reject(new HostCommandError(
          "CONNECTION_CLOSED",
          "The isolated Pi package worker request could not be delivered.",
          true
        )));
      });
    });
  }
}

export function createWorkerBackedExtensionPackageManagement(
  services: PiWorkspaceRuntimeServices,
  worker: PackageWorkerPort = new PackageWorkerClient()
): ExtensionPackageManagementPort {
  const local = new ExtensionPackageManagement({
    packageManager: services.packageManager,
    settingsManager: services.settingsManager
  });
  return {
    list: () => local.list(),
    checkForUpdates: async () => parseUpdatesResult(await worker.run("check-updates", services)),
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
    const result = parseMutationResult(await worker.run(action, services, { source, scope }));
    await reloadDesktopSettings(services.settingsManager);
    const current = local.list();
    return { ...current, changed: result.changed };
  }
}

function parseMutationResult(value: unknown): ExtensionPackageMutationResult {
  if (!isRecord(value) || typeof value.changed !== "boolean") throw invalidWorkerResult();
  const list = parseListResult(value);
  return { ...list, changed: value.changed };
}

function parseUpdatesResult(value: unknown): ExtensionPackageUpdatesResult {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 512) throw invalidWorkerResult();
  const items = value.items.map((item) => {
    if (
      !isRecord(item)
      || typeof item.source !== "string"
      || (item.scope !== "global" && item.scope !== "project")
      || (item.type !== "npm" && item.type !== "git")
      || typeof item.displayName !== "string"
    ) throw invalidWorkerResult();
    return {
      source: item.source,
      scope: item.scope as "global" | "project",
      type: item.type as "npm" | "git",
      displayName: item.displayName
    };
  });
  if (value.total !== items.length) throw invalidWorkerResult();
  return { items, total: items.length };
}

function parseListResult(value: Record<string, unknown>): ExtensionPackageListResult {
  if (!Array.isArray(value.items) || value.items.length > 512) throw invalidWorkerResult();
  const items = value.items.map((item) => {
    if (
      !isRecord(item)
      || typeof item.source !== "string"
      || (item.scope !== "global" && item.scope !== "project")
      || typeof item.enabled !== "boolean"
      || typeof item.filtered !== "boolean"
      || typeof item.installed !== "boolean"
    ) throw invalidWorkerResult();
    return {
      source: item.source,
      scope: item.scope as "global" | "project",
      enabled: item.enabled,
      filtered: item.filtered,
      installed: item.installed
    };
  });
  if (value.total !== items.length) throw invalidWorkerResult();
  return { items, total: items.length };
}

function invalidWorkerResult(): HostCommandError {
  return new HostCommandError(
    "INTERNAL",
    "The isolated Pi package worker returned an invalid result.",
    true
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
