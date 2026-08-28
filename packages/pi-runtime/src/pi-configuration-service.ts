import { join, resolve } from "node:path";
import {
  ModelRuntime,
  SettingsManager,
  type SettingsManager as PiSettingsManager
} from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type {
  PiConfigurationChangeSource,
  PiConfigurationReloadState,
  PiCredentialRevealResult,
  PiDefaultModelSelection,
  PiModelCatalogRefreshResult,
  PiProviderConfigurationChanged,
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot,
  PiVisionAssistantOverride
} from "@pi67/protocol";
import { PiAuthCredentialStore } from "./pi-auth-credential-store.js";
import {
  PiConfigurationWatcher,
  readModelConfigurationBundle,
  type PiConfigurationPaths,
  type WorkspaceConfigurationState
} from "./pi-configuration-file-state.js";
import {
  refreshPiConfigurationProjection,
  type ValidatedConfigurationRuntimeCandidate
} from "./pi-configuration-projection.js";
import {
  resolvePiConfigurationServiceOptions,
  withPiConfigurationBudget,
  type PiConfigurationServiceOptions,
  type ResolvedPiConfigurationServiceOptions
} from "./pi-configuration-service-options.js";
import { normalizeSessionCatalogWorkspaceIdentity as workspaceIdentity } from "./session-path-identity.js";
import { installFirstPartyModelProviders } from "./first-party-model-providers.js";
import { PiConfigurationMutations } from "./pi-configuration-mutations.js";
import { PiModelCatalogRefreshCoordinator } from "./pi-model-catalog-refresh.js";

export type { PiConfigurationServiceOptions } from "./pi-configuration-service-options.js";
export interface PiConfigurationReloadTarget {
  requestConfigurationReload(revision: string): Promise<PiConfigurationReloadState>;
  requestModelCatalogReload(): Promise<PiConfigurationReloadState>;
}
export interface RegisterPiConfigurationWorkspaceOptions {
  cwd: string;
  settingsManager: PiSettingsManager;
  projectTrusted: boolean;
}

interface TaskModelRuntimeCandidate {
  runtime: ModelRuntime;
  modelsRevision: string;
  authRevision: string;
}

export class PiConfigurationService {
  readonly agentDir: string;
  readonly modelsPath: string;
  readonly authPath: string;
  readonly globalSettingsPath: string;
  private readonly paths: PiConfigurationPaths;
  private readonly credentials: PiAuthCredentialStore;
  private readonly globalState: WorkspaceConfigurationState;
  private readonly workspaces = new Map<string, WorkspaceConfigurationState>();
  private readonly watcher: PiConfigurationWatcher;
  private readonly limits: ResolvedPiConfigurationServiceOptions;
  private readonly mutations: PiConfigurationMutations;
  private readonly modelCatalogRefresh: PiModelCatalogRefreshCoordinator;
  private modelRuntime: ModelRuntime | undefined;
  private taskModelRuntimeCandidate: TaskModelRuntimeCandidate | undefined;
  private taskModelRuntimeLoad: Promise<TaskModelRuntimeCandidate> | undefined;
  private operationTail: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(agentDir: string, options: PiConfigurationServiceOptions = {}) {
    this.limits = resolvePiConfigurationServiceOptions(options);
    this.agentDir = resolve(agentDir);
    this.modelsPath = join(this.agentDir, "models.json");
    this.authPath = join(this.agentDir, "auth.json");
    this.globalSettingsPath = join(this.agentDir, "settings.json");
    this.paths = {
      modelsPath: this.modelsPath,
      authPath: this.authPath,
      globalSettingsPath: this.globalSettingsPath
    };
    this.credentials = new PiAuthCredentialStore(this.authPath, {
      readWaitMs: this.limits.fileAccessWaitMs
    });
    this.globalState = {
      cwd: this.agentDir,
      settingsManager: SettingsManager.create(this.agentDir, this.agentDir, { projectTrusted: false }),
      projectTrusted: false,
      registrations: 1,
      listeners: new Set(),
      runtimes: new Set()
    };
    this.watcher = new PiConfigurationWatcher({
      agentDir: this.agentDir,
      fallbackPollMs: this.limits.fallbackPollMs,
      watchDebounceMs: this.limits.watchDebounceMs,
      workspaces: this.workspaces,
      isDisposed: () => this.disposed,
      refresh: () => this.serial(() => this.refreshLocked("external", true, false))
    });
    this.mutations = new PiConfigurationMutations({
      agentDir: this.agentDir,
      authPath: this.authPath,
      paths: this.paths,
      credentials: this.credentials,
      globalState: this.globalState,
      limits: this.limits,
      serial: (operation) => this.serial(operation),
      requireWorkspace: (cwd) => this.requireWorkspace(cwd),
      requireModelRuntime: () => this.requireModelRuntime(),
      createValidationRuntime: () => this.createPiValidationRuntime(),
      currentModelRuntime: () => this.modelRuntime,
      refresh: (source, emit, force, states, validatedRuntime) => (
        this.refreshLocked(source, emit, force, states, validatedRuntime)
      )
    });
    this.modelCatalogRefresh = new PiModelCatalogRefreshCoordinator({
      timeoutMs: this.limits.modelCatalogRefreshWaitMs,
      createRuntime: (signal) => this.createPiModelRuntime(signal)
    });
    this.watcher.start();
  }

  subscribeGlobal(listener: (change: PiProviderConfigurationChanged) => void): () => void {
    this.assertActive();
    this.globalState.listeners.add(listener);
    return () => this.globalState.listeners.delete(listener);
  }

  registerWorkspace(options: RegisterPiConfigurationWorkspaceOptions): () => void {
    this.assertActive();
    const cwd = resolve(options.cwd);
    const existing = this.workspaces.get(workspaceIdentity(cwd));
    if (existing) {
      existing.registrations += 1;
      existing.settingsManager = options.settingsManager;
      existing.projectTrusted = options.projectTrusted;
      return () => this.unregisterWorkspace(cwd);
    }
    const state: WorkspaceConfigurationState = {
      cwd,
      settingsManager: options.settingsManager,
      projectTrusted: options.projectTrusted,
      registrations: 1,
      listeners: new Set(),
      runtimes: new Set()
    };
    this.workspaces.set(workspaceIdentity(cwd), state);
    this.watcher.start();
    this.watcher.schedule();
    return () => this.unregisterWorkspace(cwd);
  }

  setProjectTrusted(cwd: string, trusted: boolean): void {
    const state = this.requireWorkspace(cwd);
    if (state.projectTrusted === trusted) return;
    state.projectTrusted = trusted;
    this.watcher.schedule();
  }

  subscribe(cwd: string, listener: (change: PiProviderConfigurationChanged) => void): () => void {
    const state = this.requireWorkspace(cwd);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  registerRuntime(cwd: string, runtime: PiConfigurationReloadTarget): () => void {
    const state = this.requireWorkspace(cwd);
    state.runtimes.add(runtime);
    return () => state.runtimes.delete(runtime);
  }

  createModelRuntime(): Promise<ModelRuntime> {
    this.assertActive();
    const candidate = this.resolveTaskModelRuntimeCandidate(true);
    const activeLoad = this.taskModelRuntimeLoad;
    return withPiConfigurationBudget(
      candidate.then(({ runtime }) => runtime),
      this.limits.validationRuntimeWaitMs,
      "session-model-runtime"
    ).catch((error: unknown) => {
      if (activeLoad && this.taskModelRuntimeLoad === activeLoad) {
        this.taskModelRuntimeLoad = undefined;
        this.taskModelRuntimeCandidate = undefined;
      }
      throw error;
    });
  }

  prewarmModelRuntime(): void {
    this.assertActive();
    void this.resolveTaskModelRuntimeCandidate(false).catch(() => undefined);
  }

  get(cwd: string): Promise<PiProviderConfigurationSnapshot> {
    return this.serial(async () => {
      const state = this.requireWorkspace(cwd);
      await this.refreshLocked("manual", false, state.snapshot === undefined, [state]);
      return this.requireSnapshot(state);
    });
  }

  getGlobal(): Promise<PiProviderConfigurationSnapshot> {
    return this.serial(async () => {
      await this.refreshLocked("manual", false, this.globalState.snapshot === undefined, [this.globalState]);
      return this.requireSnapshot(this.globalState);
    });
  }

  reload(cwd: string): Promise<PiProviderConfigurationSnapshot> {
    return this.serial(async () => {
      const state = this.requireWorkspace(cwd);
      await this.refreshLocked("manual", true, true, [state]);
      return this.requireSnapshot(state);
    });
  }

  reloadGlobal(): Promise<PiProviderConfigurationSnapshot> {
    return this.serial(async () => {
      await this.refreshLocked("manual", true, true, [this.globalState]);
      return this.requireSnapshot(this.globalState);
    });
  }

  async refreshModelCatalogs(force: boolean): Promise<PiModelCatalogRefreshResult> {
    this.assertActive();
    const receipt = await this.modelCatalogRefresh.refresh(force);
    return this.serial(async () => {
      this.assertActive();
      const projectCatalog = ["current", "partial", "timed-out"].includes(receipt.status);
      if (projectCatalog) {
        this.taskModelRuntimeCandidate = undefined;
        this.taskModelRuntimeLoad = undefined;
      }
      await this.refreshLocked(projectCatalog ? "catalog" : "manual", projectCatalog, true);
      return { ...receipt, snapshot: this.requireSnapshot(this.globalState) };
    });
  }
  cancelModelCatalogRefresh(): void { this.modelCatalogRefresh.cancel(); }
  saveGlobalProvider(expectedRevision: string, provider: PiProviderConfigurationInput): Promise<PiProviderConfigurationSnapshot> {
    return this.mutations.saveGlobalProvider(expectedRevision, provider); }
  removeGlobalProvider(expectedRevision: string, providerId: string): Promise<PiProviderConfigurationSnapshot> {
    return this.mutations.removeGlobalProvider(expectedRevision, providerId); }
  storeGlobalCredential(expectedRevision: string, providerId: string, apiKey: string): Promise<PiProviderConfigurationSnapshot> {
    return this.mutations.storeGlobalCredential(expectedRevision, providerId, apiKey); }
  removeGlobalCredential(expectedRevision: string, providerId: string): Promise<PiProviderConfigurationSnapshot> {
    return this.mutations.removeGlobalCredential(expectedRevision, providerId); }
  revealGlobalCredential(expectedRevision: string, providerId: string): Promise<PiCredentialRevealResult> {
    return this.mutations.revealGlobalCredential(expectedRevision, providerId); }
  setGlobalDefaultModel(expectedRevision: string, selection?: PiDefaultModelSelection): Promise<PiProviderConfigurationSnapshot> {
    return this.mutations.setGlobalDefaultModel(expectedRevision, selection); }
  setGlobalVisionAssistant(expectedRevision: string, selection?: PiDefaultModelSelection): Promise<PiProviderConfigurationSnapshot> {
    return this.mutations.setGlobalVisionAssistant(expectedRevision, selection); }
  setProjectVisionAssistant(cwd: string, expectedRevision: string,
    override?: PiVisionAssistantOverride): Promise<PiProviderConfigurationSnapshot> {
    return this.mutations.setProjectVisionAssistant(cwd, expectedRevision, override); }
  setProjectDefaultModel(cwd: string, expectedRevision: string,
    selection?: PiDefaultModelSelection): Promise<PiProviderConfigurationSnapshot> {
    return this.mutations.setProjectDefaultModel(cwd, expectedRevision, selection); }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.watcher.dispose();
    await this.modelCatalogRefresh.dispose();
    const activeTaskModelRuntimeLoad = this.taskModelRuntimeLoad;
    if (activeTaskModelRuntimeLoad) {
      await withPiConfigurationBudget(
        activeTaskModelRuntimeLoad,
        this.limits.validationRuntimeWaitMs,
        "session-model-runtime"
      ).catch(() => undefined);
    }
    await this.operationTail.catch(() => undefined);
    this.globalState.listeners.clear();
    this.globalState.runtimes.clear();
    this.workspaces.clear();
    this.taskModelRuntimeCandidate = undefined;
    this.taskModelRuntimeLoad = undefined;
  }

  private async refreshLocked(
    source: PiConfigurationChangeSource,
    emit: boolean,
    force: boolean,
    states?: WorkspaceConfigurationState[],
    validatedRuntime?: ValidatedConfigurationRuntimeCandidate
  ): Promise<void> {
    this.watcher.ensureDirectoryWatchers();
    await refreshPiConfigurationProjection({
      states: states ?? [this.globalState, ...this.workspaces.values()],
      paths: this.paths,
      credentials: this.credentials,
      source,
      emit,
      force,
      runtimeReloadWaitMs: this.limits.runtimeReloadWaitMs,
      fileAccessWaitMs: this.limits.fileAccessWaitMs,
      validationRuntimeWaitMs: this.limits.validationRuntimeWaitMs,
      settingsReloadWaitMs: this.limits.settingsReloadWaitMs,
      ...(validatedRuntime ? { validatedRuntime } : {}),
      createValidationRuntime: () => source === "catalog"
        ? this.createPiModelRuntime()
        : this.createPiValidationRuntime(),
      installModelRuntime: (runtime) => { this.modelRuntime = runtime; }
    });
  }

  private async createPiValidationRuntime(): Promise<ModelRuntime> {
    if (this.taskModelRuntimeCandidate || this.taskModelRuntimeLoad) {
      const candidate = await withPiConfigurationBudget(
        this.resolveTaskModelRuntimeCandidate(false),
        this.limits.validationRuntimeWaitMs,
        "provider-validation-runtime"
      );
      return candidate.runtime;
    }
    return withPiConfigurationBudget(
      this.createPiModelRuntime(),
      this.limits.validationRuntimeWaitMs,
      "provider-validation-runtime"
    );
  }

  private async requireModelRuntime(): Promise<ModelRuntime> {
    this.modelRuntime ??= await this.createModelRuntime();
    return this.modelRuntime;
  }

  private async createPiModelRuntime(signal?: AbortSignal): Promise<ModelRuntime> {
    const runtime = await ModelRuntime.create({
      credentials: this.credentials,
      modelsPath: this.modelsPath,
      allowModelNetwork: false,
      ...(signal ? { signal } : {})
    });
    await installFirstPartyModelProviders(runtime);
    return runtime;
  }

  private resolveTaskModelRuntimeCandidate(consume: boolean): Promise<TaskModelRuntimeCandidate> {
    const operation = this.taskModelRuntimeCandidate
      ? Promise.resolve(this.taskModelRuntimeCandidate)
      : this.taskModelRuntimeLoad ?? this.beginTaskModelRuntimeLoad();
    return operation.then(async (candidate) => {
      this.assertActive();
      const current = await readModelConfigurationBundle(
        this.paths,
        this.limits.fileAccessWaitMs
      );
      const matches = candidate.modelsRevision === current.models.revision
        && candidate.authRevision === current.auth.revision;
      if (!matches) {
        if (this.taskModelRuntimeCandidate === candidate) this.taskModelRuntimeCandidate = undefined;
        if (this.taskModelRuntimeLoad === operation) this.taskModelRuntimeLoad = undefined;
        return this.resolveTaskModelRuntimeCandidate(consume);
      }
      if (consume && this.taskModelRuntimeCandidate === candidate) {
        this.taskModelRuntimeCandidate = undefined;
      }
      if (consume && this.taskModelRuntimeLoad === operation) this.taskModelRuntimeLoad = undefined;
      if (consume) this.scheduleTaskModelRuntimePrewarm();
      return candidate;
    });
  }

  private scheduleTaskModelRuntimePrewarm(): void {
    queueMicrotask(() => {
      if (this.disposed || this.taskModelRuntimeCandidate || this.taskModelRuntimeLoad) return;
      void this.resolveTaskModelRuntimeCandidate(false).catch(() => undefined);
    });
  }

  private beginTaskModelRuntimeLoad(): Promise<TaskModelRuntimeCandidate> {
    const load = (async () => {
      const before = await readModelConfigurationBundle(
        this.paths,
        this.limits.fileAccessWaitMs
      );
      const authError = this.credentials.loadContent(before.auth.content);
      if (authError) {
        throw new Error(`Pi could not load auth.json: ${authError}`);
      }
      const runtime = await this.createPiModelRuntime();
      if (this.disposed) {
        return {
          runtime,
          modelsRevision: before.models.revision,
          authRevision: before.auth.revision
        };
      }
      const after = await readModelConfigurationBundle(
        this.paths,
        this.limits.fileAccessWaitMs
      );
      if (
        before.models.revision !== after.models.revision
        || before.auth.revision !== after.auth.revision
      ) {
        throw new RuntimeError(
          "CONFIGURATION_CHANGED_EXTERNALLY",
          "Pi Provider configuration changed while Desktop was preparing the first Task runtime.",
          { recoverable: true }
        );
      }
      return {
        runtime,
        modelsRevision: after.models.revision,
        authRevision: after.auth.revision
      };
    })();
    this.taskModelRuntimeLoad = load;
    void load.then((candidate) => {
      if (!this.disposed && this.taskModelRuntimeLoad === load) {
        this.taskModelRuntimeCandidate = candidate;
        this.taskModelRuntimeLoad = undefined;
      }
    }, () => {
      if (this.taskModelRuntimeLoad === load) this.taskModelRuntimeLoad = undefined;
    });
    return load;
  }

  private unregisterWorkspace(cwd: string): void {
    const state = this.workspaces.get(workspaceIdentity(cwd));
    if (!state) return;
    state.registrations -= 1;
    if (state.registrations > 0) return;
    state.projectWatcher?.close();
    this.workspaces.delete(workspaceIdentity(cwd));
  }

  private requireWorkspace(cwd: string): WorkspaceConfigurationState {
    const state = this.workspaces.get(workspaceIdentity(cwd));
    if (state) return state;
    throw new RuntimeError("RUNTIME_NOT_READY", "Pi configuration is not registered for this Workspace.");
  }

  private requireSnapshot(state: WorkspaceConfigurationState): PiProviderConfigurationSnapshot {
    if (state.snapshot) return state.snapshot;
    throw new RuntimeError("RUNTIME_NOT_READY", "Pi configuration has not finished loading.");
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation);
    this.operationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private assertActive(): void {
    if (this.disposed) throw new RuntimeError("RUNTIME_NOT_READY", "Pi configuration service is disposed.");
  }
}
