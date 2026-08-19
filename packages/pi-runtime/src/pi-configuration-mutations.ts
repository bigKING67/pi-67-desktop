import { SettingsManager, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type {
  PiConfigurationChangeSource,
  PiConfigurationFileKind,
  PiCredentialRevealResult,
  PiDefaultModelSelection,
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot,
  PiVisionAssistantOverride
} from "@pi67/protocol";
import { withConfigurationFileLock, writePrivateFileAtomically } from "./atomic-private-file.js";
import {
  removeProviderDocument,
  saveProviderDocument,
  setDefaultModelDocument,
  setVisionAssistantDocument
} from "./pi-configuration-documents.js";
import {
  authContentRevision,
  revealStoredApiKey,
  type PiAuthCredentialMutationResult,
  type PiAuthCredentialStore
} from "./pi-auth-credential-store.js";
import { commitPiCredentialMutation } from "./pi-credential-mutation-transaction.js";
import {
  assertExpectedConfigurationRevision,
  configurationPath,
  ensureTrailingNewline,
  readOptionalConfigurationFile,
  readWorkspaceConfigurationBundle,
  restoreConfigurationFile,
  type PiConfigurationPaths,
  type WorkspaceBundle,
  type WorkspaceConfigurationState
} from "./pi-configuration-file-state.js";
import {
  currentValidatedRuntimeCandidate,
  type ValidatedConfigurationRuntimeCandidate
} from "./pi-configuration-projection.js";
import type { ResolvedPiConfigurationServiceOptions } from "./pi-configuration-service-options.js";

interface PiConfigurationMutationHost {
  agentDir: string;
  authPath: string;
  paths: PiConfigurationPaths;
  credentials: PiAuthCredentialStore;
  globalState: WorkspaceConfigurationState;
  limits: ResolvedPiConfigurationServiceOptions;
  serial<T>(operation: () => Promise<T>): Promise<T>;
  requireWorkspace(cwd: string): WorkspaceConfigurationState;
  requireModelRuntime(): Promise<ModelRuntime>;
  createValidationRuntime(): Promise<ModelRuntime>;
  currentModelRuntime(): ModelRuntime | undefined;
  refresh(
    source: PiConfigurationChangeSource,
    emit: boolean,
    force: boolean,
    states?: WorkspaceConfigurationState[],
    validatedRuntime?: ValidatedConfigurationRuntimeCandidate
  ): Promise<void>;
}

export class PiConfigurationMutations {
  constructor(private readonly host: PiConfigurationMutationHost) {}

  saveGlobalProvider(
    expectedRevision: string,
    provider: PiProviderConfigurationInput
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateGlobalDocument(expectedRevision, "models", (content) => (
      saveProviderDocument(content, provider)
    ), async () => {
      const runtime = await this.host.createValidationRuntime();
      const error = runtime.getError();
      if (error) throw new Error(`Pi rejected models.json: ${error}`);
      if (!runtime.getProvider(provider.id)) {
        throw new Error(`Pi did not register the saved Provider: ${provider.id}.`);
      }
    });
  }

  removeGlobalProvider(
    expectedRevision: string,
    providerId: string
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateGlobalDocument(expectedRevision, "models", (content) => (
      removeProviderDocument(content, providerId)
    ), async () => {
      const runtime = await this.host.createValidationRuntime();
      const error = runtime.getError();
      if (error) throw new Error(`Pi rejected models.json: ${error}`);
    });
  }

  storeGlobalCredential(
    expectedRevision: string,
    providerId: string,
    apiKey: string
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateGlobalCredential(expectedRevision, async (bundle) => {
      const runtime = await this.host.requireModelRuntime();
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
        signal: AbortSignal.timeout(this.host.limits.validationRuntimeWaitMs),
        prompt: async (prompt) => {
          if (prompt.type === "secret" || prompt.type === "text" || prompt.type === "manual_code") {
            return apiKey;
          }
          throw new Error("This Provider requires an interactive authentication choice that is not an API key.");
        },
        notify: () => undefined
      });
      return this.host.credentials.replaceExpected(
        providerId,
        credential,
        authContentRevision(bundle.byKind.auth.content)
      );
    });
  }

  removeGlobalCredential(
    expectedRevision: string,
    providerId: string
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateGlobalCredential(expectedRevision, (bundle) => (
      this.host.credentials.deleteExpected(
        providerId,
        authContentRevision(bundle.byKind.auth.content)
      )
    ));
  }

  revealGlobalCredential(
    expectedRevision: string,
    providerId: string
  ): Promise<PiCredentialRevealResult> {
    return this.host.serial(async () => {
      const bundle = await readWorkspaceConfigurationBundle(
        this.host.paths,
        this.host.globalState,
        this.host.limits.fileAccessWaitMs
      );
      assertExpectedConfigurationRevision(bundle, expectedRevision);
      return {
        provider: providerId,
        ...revealStoredApiKey(bundle.byKind.auth.content, providerId)
      };
    });
  }

  setGlobalDefaultModel(
    expectedRevision: string,
    selection?: PiDefaultModelSelection
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.host.serial(async () => {
      await this.assertConfiguredModel(selection);
      return this.mutateDocumentLocked(
        this.host.globalState,
        expectedRevision,
        "global-settings",
        (content) => setDefaultModelDocument(content, selection),
        async () => {
          const validation = SettingsManager.create(this.host.agentDir, this.host.agentDir, {
            projectTrusted: false
          });
          const error = validation.drainErrors().find((item) => item.scope === "global");
          if (error) throw error.error;
        }
      );
    });
  }

  setGlobalVisionAssistant(
    expectedRevision: string,
    selection?: PiDefaultModelSelection
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.host.serial(async () => {
      await this.assertConfiguredImageModel(selection);
      return this.mutateDocumentLocked(
        this.host.globalState,
        expectedRevision,
        "global-settings",
        (content) => setVisionAssistantDocument(
          content,
          selection ? { mode: "model", ...selection } : undefined
        ),
        async () => {
          const validation = SettingsManager.create(this.host.agentDir, this.host.agentDir, {
            projectTrusted: false
          });
          const error = validation.drainErrors().find((item) => item.scope === "global");
          if (error) throw error.error;
        }
      );
    });
  }

  setProjectVisionAssistant(
    cwd: string,
    expectedRevision: string,
    override?: PiVisionAssistantOverride
  ): Promise<PiProviderConfigurationSnapshot> {
    const state = this.requireTrustedWorkspace(cwd);
    return this.host.serial(async () => {
      await this.assertConfiguredImageModel(override?.mode === "model" ? override : undefined);
      return this.mutateProjectSettings(state, expectedRevision, (content) => (
        setVisionAssistantDocument(content, override)
      ));
    });
  }

  setProjectDefaultModel(
    cwd: string,
    expectedRevision: string,
    selection?: PiDefaultModelSelection
  ): Promise<PiProviderConfigurationSnapshot> {
    const state = this.requireTrustedWorkspace(cwd);
    return this.host.serial(async () => {
      await this.assertConfiguredModel(selection);
      return this.mutateProjectSettings(state, expectedRevision, (content) => (
        setDefaultModelDocument(content, selection)
      ));
    });
  }

  private mutateGlobalDocument(
    expectedRevision: string,
    target: Exclude<PiConfigurationFileKind, "project-settings">,
    update: (content: string | undefined) => string,
    validate: () => Promise<void>
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.host.serial(() => this.mutateDocumentLocked(
      this.host.globalState,
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
    const path = configurationPath(this.host.paths, state, target);
    let previousContent: string | undefined;
    let writtenContent = "";
    let beforeBundle: WorkspaceBundle | undefined;
    await withConfigurationFileLock(path, async () => {
      beforeBundle = await readWorkspaceConfigurationBundle(
        this.host.paths,
        state,
        this.host.limits.fileAccessWaitMs
      );
      assertExpectedConfigurationRevision(beforeBundle, expectedRevision);
      previousContent = beforeBundle.byKind[target].content;
      writtenContent = ensureTrailingNewline(update(previousContent));
      await writePrivateFileAtomically(path, writtenContent);
    });
    try {
      await validate();
    } catch (error) {
      await withConfigurationFileLock(path, async () => {
        const current = await readOptionalConfigurationFile(path, this.host.limits.fileAccessWaitMs);
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
    const validatedRuntime = beforeBundle
      ? currentValidatedRuntimeCandidate(this.host.currentModelRuntime(), state, beforeBundle)
      : undefined;
    await this.host.refresh("desktop", true, true, undefined, validatedRuntime);
    return requireSnapshot(state);
  }

  private mutateGlobalCredential(
    expectedRevision: string,
    mutation: (bundle: WorkspaceBundle) => Promise<PiAuthCredentialMutationResult>
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.host.serial(async () => {
      const beforeBundle = await readWorkspaceConfigurationBundle(
        this.host.paths,
        this.host.globalState,
        this.host.limits.fileAccessWaitMs
      );
      assertExpectedConfigurationRevision(beforeBundle, expectedRevision);
      const committed = await commitPiCredentialMutation({
        authPath: this.host.authPath,
        credentials: this.host.credentials,
        fileAccessWaitMs: this.host.limits.fileAccessWaitMs,
        mutate: () => mutation(beforeBundle),
        createValidationRuntime: () => this.host.createValidationRuntime()
      });
      await this.host.refresh("desktop", true, true, undefined, {
        runtime: committed.runtime,
        modelsRevision: beforeBundle.byKind.models.revision,
        authRevision: authContentRevision(committed.result.writtenContent),
        onAuthRevisionMismatch: (content) => committed.restoreStore(content)
      });
      return requireSnapshot(this.host.globalState);
    });
  }

  private mutateProjectSettings(
    state: WorkspaceConfigurationState,
    expectedRevision: string,
    update: (content: string | undefined) => string
  ): Promise<PiProviderConfigurationSnapshot> {
    return this.mutateDocumentLocked(state, expectedRevision, "project-settings", update, async () => {
      const validation = SettingsManager.create(state.cwd, this.host.agentDir, { projectTrusted: true });
      const error = validation.drainErrors().find((item) => item.scope === "project");
      if (error) throw error.error;
    });
  }

  private requireTrustedWorkspace(cwd: string): WorkspaceConfigurationState {
    const state = this.host.requireWorkspace(cwd);
    if (state.projectTrusted) return state;
    throw new RuntimeError(
      "WORKSPACE_NOT_TRUSTED",
      "Trust this Workspace before writing project Pi settings.",
      { recoverable: false }
    );
  }

  private async assertConfiguredModel(selection: PiDefaultModelSelection | undefined): Promise<void> {
    if (!selection) return;
    const runtime = await this.host.requireModelRuntime();
    if (runtime.getModel(selection.provider, selection.model)) return;
    throw new RuntimeError("MODEL_NOT_FOUND", "The selected Pi default model is not configured.", {
      recoverable: false,
      details: { provider: selection.provider, modelId: selection.model }
    });
  }

  private async assertConfiguredImageModel(selection: PiDefaultModelSelection | undefined): Promise<void> {
    if (!selection) return;
    const runtime = await this.host.requireModelRuntime();
    const model = runtime.getModel(selection.provider, selection.model);
    if (model?.input.includes("image")) return;
    throw new RuntimeError("MODEL_NOT_FOUND", "The selected Pi visual-assistance model is not configured for image input.", {
      recoverable: false,
      details: { provider: selection.provider, modelId: selection.model }
    });
  }
}

function requireSnapshot(state: WorkspaceConfigurationState): PiProviderConfigurationSnapshot {
  if (state.snapshot) return state.snapshot;
  throw new RuntimeError("RUNTIME_NOT_READY", "Pi configuration has not finished loading.");
}
