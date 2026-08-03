import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type {
  SessionCatalogPage,
  SessionCatalogQuery,
  SessionCatalogStatus
} from "@pi67/domain";
import {
  createRuntimeSessionCatalogOwner,
  createPiWorkspaceRuntimeServices,
  PiConfigurationServiceRegistry,
  type AgentRuntime,
  type CreatePiWorkspaceRuntimeServicesOptions,
  type PiWorkspaceRuntimeServices,
  type RuntimeSessionCatalogOwner
} from "@pi67/pi-runtime";
import type { AgentEvent } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

export interface WorkspaceContextRecord {
  readonly workspaceId: string;
  readonly canonicalCwd: string;
  readonly cwd: string;
  readonly agentDir: string;
  readonly workspaceServices: PiWorkspaceRuntimeServices;
  readonly sessionCatalog: ReturnType<
    PiWorkspaceRuntimeServices["sessionCatalog"]["createBinding"]
  >;
  readonly configurationUnsubscribe?: () => void;
  initialization: Parameters<AgentRuntime["initialize"]>[0];
}

export interface RegisterWorkspaceContextOptions extends Omit<
  CreatePiWorkspaceRuntimeServicesOptions,
  "settingsManager" | "projectTrusted" | "sessionCatalogOwner"
> {
  trust: Parameters<AgentRuntime["initialize"]>[0]["trust"];
  approvalMode: Parameters<AgentRuntime["initialize"]>[0]["approvalMode"];
}

export type WorkspaceServicesFactory = (
  options: CreatePiWorkspaceRuntimeServicesOptions
) => PiWorkspaceRuntimeServices;

export interface WorkspaceContextRegistryOptions {
  createServices?: WorkspaceServicesFactory;
  createSessionCatalogOwner?: (
    directory?: string,
    storageRoot?: string
  ) => RuntimeSessionCatalogOwner;
  configurationServices?: PiConfigurationServiceRegistry;
  emitWorkspaceEvent?: (workspaceId: string, event: AgentEvent) => void;
}

export class WorkspaceContextRegistry {
  private readonly records = new Map<string, WorkspaceContextRecord>();
  private readonly workspaceIdsByCanonicalCwd = new Map<string, string>();
  private readonly createServices: WorkspaceServicesFactory;
  private readonly createSessionCatalogOwner: NonNullable<
    WorkspaceContextRegistryOptions["createSessionCatalogOwner"]
  >;
  private readonly configurationServices: PiConfigurationServiceRegistry;
  private emitWorkspaceEvent: NonNullable<WorkspaceContextRegistryOptions["emitWorkspaceEvent"]>;
  private sessionCatalogOwner: RuntimeSessionCatalogOwner | undefined;
  private sessionCatalogStorageIdentity: SessionCatalogStorageIdentity | undefined;

  constructor(options: WorkspaceContextRegistryOptions = {}) {
    this.createServices = options.createServices ?? createPiWorkspaceRuntimeServices;
    this.createSessionCatalogOwner = options.createSessionCatalogOwner
      ?? createRuntimeSessionCatalogOwner;
    this.configurationServices = options.configurationServices ?? new PiConfigurationServiceRegistry();
    this.emitWorkspaceEvent = options.emitWorkspaceEvent ?? (() => undefined);
  }

  setEventSink(
    emitWorkspaceEvent: NonNullable<WorkspaceContextRegistryOptions["emitWorkspaceEvent"]>
  ): void {
    this.emitWorkspaceEvent = emitWorkspaceEvent;
  }

  register(
    workspaceId: string,
    options: RegisterWorkspaceContextOptions
  ): WorkspaceContextRecord {
    const cwd = canonicalizeWorkspaceCwd(options.cwd);
    const canonicalCwd = workspaceCwdIdentity(cwd);
    const existing = this.records.get(workspaceId);
    if (existing) {
      if (existing.canonicalCwd !== canonicalCwd) {
        throw new HostCommandError(
          "INVALID_PAYLOAD",
          "The Workspace identity is already registered for a different directory.",
          false
        );
      }
      existing.workspaceServices.assertCompatible(cwd, options.agentDir);
      this.requireSessionCatalogOwner(options);
      existing.workspaceServices.setProjectTrusted(options.trust === "trusted");
      existing.initialization = initializationFrom(options, existing.cwd, existing.agentDir);
      return existing;
    }
    const owner = this.workspaceIdsByCanonicalCwd.get(canonicalCwd);
    if (owner !== undefined) {
      throw new HostCommandError(
        "DUPLICATE_REQUEST",
        "The Workspace directory is already registered with another identity.",
        false,
        { registeredWorkspaceId: owner }
      );
    }
    const sessionCatalogOwner = this.requireSessionCatalogOwner(options);
    const configurationService = this.configurationServices.acquire(options.agentDir);
    const workspaceServices = this.createServices({
      cwd,
      agentDir: options.agentDir,
      configurationService,
      sessionCatalogOwner,
      projectTrusted: options.trust === "trusted",
      ...(options.runtimeCredentialOverrides === undefined
        ? {}
        : { runtimeCredentialOverrides: options.runtimeCredentialOverrides }),
      ...(options.sessionCatalogDirectory === undefined
        ? {}
        : { sessionCatalogDirectory: options.sessionCatalogDirectory }),
      ...(options.storageRoot === undefined ? {} : { storageRoot: options.storageRoot })
    });
    const sessionCatalog = workspaceServices.sessionCatalog.createBinding({
      emit: (event) => this.emitWorkspaceEvent(workspaceId, event),
      getAgentDir: () => workspaceServices.agentDir,
      getConfiguredSessionDir: () => undefined,
      getWorkspaceCwd: () => workspaceServices.cwd,
      getSessionManager: () => undefined,
      getSessionMetadata: () => {
        throw new Error("No live SessionManager is available for the Workspace catalog.");
      }
    });
    const configurationUnsubscribe = workspaceServices.configurationService?.subscribe(
      workspaceServices.cwd,
      (change) => this.emitWorkspaceEvent(workspaceId, {
        type: "provider.configuration.changed",
        payload: change
      })
    );
    const record: WorkspaceContextRecord = {
      workspaceId,
      canonicalCwd,
      cwd: workspaceServices.cwd,
      agentDir: workspaceServices.agentDir,
      workspaceServices,
      sessionCatalog,
      ...(configurationUnsubscribe === undefined ? {} : { configurationUnsubscribe }),
      initialization: initializationFrom(options, workspaceServices.cwd, workspaceServices.agentDir)
    };
    this.records.set(workspaceId, record);
    this.workspaceIdsByCanonicalCwd.set(canonicalCwd, workspaceId);
    return record;
  }

  get(workspaceId: string): WorkspaceContextRecord | undefined {
    return this.records.get(workspaceId);
  }

  require(workspaceId: string): WorkspaceContextRecord {
    const record = this.records.get(workspaceId);
    if (record) return record;
    throw new HostCommandError(
      "RUNTIME_NOT_READY",
      "The Workspace has not been initialized in this Pi runtime service.",
      true
    );
  }

  values(): WorkspaceContextRecord[] {
    return [...this.records.values()];
  }

  workspaceIdForCwd(cwd: string): string | undefined {
    return this.workspaceIdsByCanonicalCwd.get(workspaceCwdIdentity(canonicalizeWorkspaceCwd(cwd)));
  }

  queryCatalog(workspaceId: string, query: SessionCatalogQuery): Promise<SessionCatalogPage> {
    if (query.scope !== "workspace") {
      return Promise.reject(new HostCommandError(
        "UNSUPPORTED",
        "Cross-Workspace Session Catalog aggregation is not available.",
        false
      ));
    }
    return this.require(workspaceId).sessionCatalog.query(query);
  }

  statusFor(workspaceId: string): SessionCatalogStatus {
    return this.require(workspaceId).sessionCatalog.status();
  }

  async unregister(workspaceId: string): Promise<void> {
    const record = this.require(workspaceId);
    record.configurationUnsubscribe?.();
    await record.sessionCatalog.dispose();
    await record.workspaceServices.dispose();
    this.records.delete(workspaceId);
    this.workspaceIdsByCanonicalCwd.delete(record.canonicalCwd);
  }

  async disposeAll(): Promise<void> {
    const records = [...this.records.values()].reverse();
    let firstError: unknown;
    for (const record of records) {
      let disposed = true;
      record.configurationUnsubscribe?.();
      try {
        await record.sessionCatalog.dispose();
      } catch (error) {
        disposed = false;
        firstError ??= error;
      }
      try {
        await record.workspaceServices.dispose();
      } catch (error) {
        disposed = false;
        firstError ??= error;
      }
      if (!disposed) continue;
      this.records.delete(record.workspaceId);
      this.workspaceIdsByCanonicalCwd.delete(record.canonicalCwd);
    }
    try {
      await this.configurationServices.dispose();
    } catch (error) {
      firstError ??= error;
    }
    try {
      await this.sessionCatalogOwner?.dispose();
      this.sessionCatalogOwner = undefined;
      this.sessionCatalogStorageIdentity = undefined;
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) throw firstError;
  }

  private requireSessionCatalogOwner(
    options: Pick<RegisterWorkspaceContextOptions, "sessionCatalogDirectory" | "storageRoot">
  ): RuntimeSessionCatalogOwner {
    const identity = sessionCatalogStorageIdentity(options);
    if (this.sessionCatalogOwner) {
      if (!sameSessionCatalogStorageIdentity(this.sessionCatalogStorageIdentity, identity)) {
        throw new HostCommandError(
          "INVALID_PAYLOAD",
          "All Workspaces in one Agent Host must share the same Session Catalog storage.",
          false
        );
      }
      return this.sessionCatalogOwner;
    }
    this.sessionCatalogStorageIdentity = identity;
    this.sessionCatalogOwner = this.createSessionCatalogOwner(
      options.sessionCatalogDirectory,
      options.storageRoot
    );
    return this.sessionCatalogOwner;
  }
}

interface SessionCatalogStorageIdentity {
  directory: string | undefined;
  storageRoot: string | undefined;
}

function sessionCatalogStorageIdentity(
  options: Pick<RegisterWorkspaceContextOptions, "sessionCatalogDirectory" | "storageRoot">
): SessionCatalogStorageIdentity {
  return {
    directory: normalizeOptionalPath(options.sessionCatalogDirectory),
    storageRoot: normalizeOptionalPath(options.storageRoot)
  };
}

function sameSessionCatalogStorageIdentity(
  current: SessionCatalogStorageIdentity | undefined,
  candidate: SessionCatalogStorageIdentity
): boolean {
  return current !== undefined
    && current.directory === candidate.directory
    && current.storageRoot === candidate.storageRoot;
}

function normalizeOptionalPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function initializationFrom(
  options: RegisterWorkspaceContextOptions,
  cwd: string,
  agentDir: string
): WorkspaceContextRecord["initialization"] {
  return {
    cwd,
    agentDir,
    trust: options.trust,
    approvalMode: options.approvalMode
  };
}

function canonicalizeWorkspaceCwd(cwd: string): string {
  const absolute = resolve(cwd);
  let canonical = absolute;
  try {
    canonical = realpathSync.native(absolute);
  } catch {
    // A validated directory may disappear between Main validation and Host registration.
  }
  return canonical;
}

function workspaceCwdIdentity(cwd: string): string {
  return process.platform === "win32" ? cwd.toLowerCase() : cwd;
}
