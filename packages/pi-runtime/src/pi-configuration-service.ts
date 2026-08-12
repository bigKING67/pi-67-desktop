import { join, resolve } from "node:path";
import {
  ModelRuntime,
  SettingsManager,
  type SettingsManager as PiSettingsManager
} from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type {
  PiConfigurationChangeSource,
  PiConfigurationFileKind,
  PiConfigurationReloadState,
  PiCredentialRevealResult,
  PiDefaultModelSelection,
  PiProviderConfigurationChanged,
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot
} from "@pi67/protocol";
import { withConfigurationFileLock, writePrivateFileAtomically } from "./atomic-private-file.js";
import { removeProviderDocument, saveProviderDocument, setDefaultModelDocument } from "./pi-configuration-documents.js";
import {
  authContentRevision,
  PiAuthContentChangedError,
  PiAuthCredentialStore,
  revealStoredApiKey,
  type PiAuthCredentialMutationResult
} from "./pi-auth-credential-store.js";
import {
  assertExpectedConfigurationRevision,
  configurationPath,
  ensureTrailingNewline,
  normalizeConfigurationMutationError,
  PiConfigurationWatcher,
  readOptionalConfigurationFile,
  readWorkspaceConfigurationBundle,
  restoreConfigurationFile,
  type PiConfigurationPaths,
  type WorkspaceBundle,
  type WorkspaceConfigurationState
} from "./pi-configuration-file-state.js";
import { refreshPiConfigurationProjection } from "./pi-configuration-projection.js";
import {
  resolvePiConfigurationServiceOptions,
  withPiConfigurationBudget,
  type PiConfigurationServiceOptions,
  type ResolvedPiConfigurationServiceOptions
} from "./pi-configuration-service-options.js";
import { normalizeSessionCatalogWorkspaceIdentity as workspaceIdentity } from "./session-path-identity.js";
import { installFirstPartyModelProviders } from "./first-party-model-providers.js";

export type { PiConfigurationServiceOptions } from "./pi-configuration-service-options.js";
export interface PiConfigurationReloadTarget {
  requestConfigurationReload(revision: string): Promise<PiConfigurationReloadState>;
}
export interface RegisterPiConfigurationWorkspaceOptions {
  cwd: string;
  settingsManager: PiSettingsManager;
  projectTrusted: boolean;
}
export class PiConfigurationService {
  readonly agentDir: string;
  readonly modelsPath: string;
  readonly authPath: string;
  readonly globalSettingsPath: string;
  private readonly paths: PiConfigurationPaths;
  private readonly credentials: PiAuthCredentialStore;
  private readonly workspaces = new Map<string, WorkspaceConfigurationState>();
  private readonly watcher: PiConfigurationWatcher;
  private readonly limits: ResolvedPiConfigurationServiceOptions;
  private modelRuntime: ModelRuntime | undefined;
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
    this.watcher = new PiConfigurationWatcher({
      agentDir: this.agentDir,
      fallbackPollMs: this.limits.fallbackPollMs,
      watchDebounceMs: this.limits.watchDebounceMs,
      workspaces: this.workspaces,
      isDisposed: () => this.disposed,
      refresh: () => this.serial(() => this.refreshLocked("external", true, false))
    });
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
    return withPiConfigurationBudget(
      this.createPiModelRuntime(),
      this.limits.validationRuntimeWaitMs,
      "session-model-runtime"
    );
  }

  get(cwd: string): Promise<PiProviderConfigurationSnapshot> {
    return this.serial(async () => {
      const state = this.requireWorkspace(cwd);
      await this.refreshLocked("manual", false, state.snapshot === undefined, [state]);
      return this.requireSnapshot(state);
    });
  }

  reload(cwd: string): Promise<PiProviderConfigurationSnapshot> {
    return this.serial(async () => {
      const state = this.requireWorkspace(cwd);
      await this.refreshLocked("manual", true, true, [state]);
      return this.requireSnapshot(state);
    });
  }

  saveProvider(
    cwd: string,
    expectedRevision: string,
    provider: PiProviderConfigurationInput
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateDocument(cwd, expectedRevision, "models", (content) => (
      saveProviderDocument(content, provider)
    ), async () => {
      const runtime = await this.createPiValidationRuntime();
      const error = runtime.getError();
      if (error) throw new Error(`Pi rejected models.json: ${error}`);
      if (!runtime.getProvider(provider.id)) {
        throw new Error(`Pi did not register the saved Provider: ${provider.id}.`);
      }
    });
  }

  removeProvider(
    cwd: string,
    expectedRevision: string,
    providerId: string
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateDocument(cwd, expectedRevision, "models", (content) => (
      removeProviderDocument(content, providerId)
    ), async () => {
      const runtime = await this.createPiValidationRuntime();
      const error = runtime.getError();
      if (error) throw new Error(`Pi rejected models.json: ${error}`);
    });
  }

  storeCredential(
    cwd: string,
    expectedRevision: string,
    providerId: string,
    apiKey: string
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateCredential(cwd, expectedRevision, async (bundle) => {
      const runtime = await this.requireModelRuntime();
      const provider = runtime.getProvider(providerId);
      const apiKeyAuthentication = provider?.auth.apiKey;
      if (!apiKeyAuthentication?.login) {
        throw new RuntimeError(
          "UNSUPPORTED",
          "This Pi Provider does not support persistent API-key login.",
          { recoverable: false, details: { provider: providerId } }
        );
      }
      const credential = await apiKeyAuthentication.login({
        prompt: async (prompt) => {
          if (prompt.type === "secret" || prompt.type === "text" || prompt.type === "manual_code") {
            return apiKey;
          }
          throw new Error("This Provider requires an interactive authentication choice that is not an API key.");
        },
        notify: () => undefined
      });
      return this.credentials.replaceExpected(
        providerId,
        credential,
        authContentRevision(bundle.byKind.auth.content)
      );
    });
  }

  removeCredential(
    cwd: string,
    expectedRevision: string,
    providerId: string
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateCredential(cwd, expectedRevision, (bundle) => (
      this.credentials.deleteExpected(
        providerId,
        authContentRevision(bundle.byKind.auth.content)
      )
    ));
  }

  revealCredential(cwd: string, expectedRevision: string, providerId: string): Promise<PiCredentialRevealResult> {
    return this.serial(async () => {
      const state = this.requireWorkspace(cwd);
      const bundle = await readWorkspaceConfigurationBundle(this.paths, state, this.limits.fileAccessWaitMs);
      assertExpectedConfigurationRevision(bundle, expectedRevision);
      return {
        provider: providerId,
        ...revealStoredApiKey(bundle.byKind.auth.content, providerId)
      };
    });
  }

  setDefaultModel(cwd: string, expectedRevision: string, scope: "global" | "project",
    selection?: PiDefaultModelSelection): Promise<PiProviderConfigurationSnapshot> {
    const state = this.requireWorkspace(cwd);
    if (scope === "project" && !state.projectTrusted) {
      return Promise.reject(new RuntimeError(
        "WORKSPACE_NOT_TRUSTED",
        "Trust this Workspace before writing project Pi settings.",
        { recoverable: false }
      ));
    }
    return this.serial(async () => {
      if (selection) {
        const runtime = await this.requireModelRuntime();
        if (!runtime.getModel(selection.provider, selection.model)) {
          throw new RuntimeError("MODEL_NOT_FOUND", "The selected Pi default model is not configured.", {
            recoverable: false,
            details: { provider: selection.provider, modelId: selection.model }
          });
        }
      }
      const target: PiConfigurationFileKind = scope === "global" ? "global-settings" : "project-settings";
      return this.mutateDocumentLocked(state, expectedRevision, target, (content) => (
        setDefaultModelDocument(content, selection)
      ), async () => {
        const validation = SettingsManager.create(state.cwd, this.agentDir, { projectTrusted: true });
        const errors = validation.drainErrors().filter((item) => item.scope === scope);
        if (errors[0]) throw errors[0].error;
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.watcher.dispose();
    await this.operationTail.catch(() => undefined);
    this.workspaces.clear();
  }

  private mutateDocument(
    cwd: string,
    expectedRevision: string,
    target: PiConfigurationFileKind,
    update: (content: string | undefined) => string,
    validate: () => Promise<void>
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.serial(() => this.mutateDocumentLocked(
      this.requireWorkspace(cwd),
      expectedRevision,
      target,
      update,
      validate
    ));
  }

  private async mutateDocumentLocked(
    state: WorkspaceConfigurationState,
    expectedRevision: string,
    target: PiConfigurationFileKind,
    update: (content: string | undefined) => string,
    validate: () => Promise<void>
  ): Promise<PiProviderConfigurationSnapshot> {
    const path = configurationPath(this.paths, state, target);
    let previousContent: string | undefined;
    let writtenContent = "";
    await withConfigurationFileLock(path, async () => {
      const beforeBundle = await readWorkspaceConfigurationBundle(this.paths, state, this.limits.fileAccessWaitMs);
      assertExpectedConfigurationRevision(beforeBundle, expectedRevision);
      previousContent = beforeBundle.byKind[target].content;
      writtenContent = ensureTrailingNewline(update(previousContent));
      await writePrivateFileAtomically(path, writtenContent);
    });
    try {
      await validate();
    } catch (error) {
      await withConfigurationFileLock(path, async () => {
        const current = await readOptionalConfigurationFile(path, this.limits.fileAccessWaitMs);
        if (current !== writtenContent) {
          throw new RuntimeError(
            "CONFIGURATION_CHANGED_EXTERNALLY",
            "Pi configuration changed again while Desktop was validating the saved file.",
            { recoverable: true }
          );
        }
        await restoreConfigurationFile(path, previousContent);
      });
      throw error;
    }
    await this.refreshLocked("desktop", true, true);
    return this.requireSnapshot(state);
  }

  private mutateCredential(
    cwd: string,
    expectedRevision: string,
    mutation: (bundle: WorkspaceBundle) => Promise<PiAuthCredentialMutationResult>
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.serial(async () => {
      const state = this.requireWorkspace(cwd);
      const beforeBundle = await readWorkspaceConfigurationBundle(this.paths, state, this.limits.fileAccessWaitMs);
      assertExpectedConfigurationRevision(beforeBundle, expectedRevision);
      let mutationResult: PiAuthCredentialMutationResult | undefined;
      try {
        mutationResult = await mutation(beforeBundle);
        const validation = await this.createPiValidationRuntime();
        await validation.listCredentials();
      } catch (error) {
        if (!(error instanceof PiAuthContentChangedError) && mutationResult) {
          const failedMutation = mutationResult;
          await withConfigurationFileLock(this.authPath, async () => {
            const current = await readOptionalConfigurationFile(this.authPath, this.limits.fileAccessWaitMs);
            if (current !== failedMutation.writtenContent) {
              throw new RuntimeError(
                "CONFIGURATION_CHANGED_EXTERNALLY",
                "Pi auth.json changed again while Desktop was validating the saved credential.",
                { recoverable: true }
              );
            }
            await restoreConfigurationFile(this.authPath, failedMutation.previousContent);
          });
          await this.credentials.reload();
        }
        throw normalizeConfigurationMutationError(error);
      }
      await this.refreshLocked("desktop", true, true);
      return this.requireSnapshot(state);
    });
  }

  private async refreshLocked(
    source: PiConfigurationChangeSource,
    emit: boolean,
    force: boolean,
    states: WorkspaceConfigurationState[] = [...this.workspaces.values()]
  ): Promise<void> {
    this.watcher.ensureDirectoryWatchers();
    await refreshPiConfigurationProjection({
      states,
      paths: this.paths,
      credentials: this.credentials,
      source,
      emit,
      force,
      runtimeReloadWaitMs: this.limits.runtimeReloadWaitMs,
      fileAccessWaitMs: this.limits.fileAccessWaitMs,
      validationRuntimeWaitMs: this.limits.validationRuntimeWaitMs,
      settingsReloadWaitMs: this.limits.settingsReloadWaitMs,
      createValidationRuntime: () => this.createPiValidationRuntime(),
      installModelRuntime: (runtime) => { this.modelRuntime = runtime; }
    });
  }

  private async createPiValidationRuntime(): Promise<ModelRuntime> {
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

  private async createPiModelRuntime(): Promise<ModelRuntime> {
    const runtime = await ModelRuntime.create({
      credentials: this.credentials,
      modelsPath: this.modelsPath,
      allowModelNetwork: false
    });
    await installFirstPartyModelProviders(runtime);
    return runtime;
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
