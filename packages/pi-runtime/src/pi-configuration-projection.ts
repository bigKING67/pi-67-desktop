import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type {
  PiConfigurationChangeSource,
  PiConfigurationFileKind,
  PiConfigurationReloadState,
  PiProviderConfigurationChanged
} from "@pi67/protocol";
import {
  changedConfigurationFiles,
  configurationErrorMessage,
  fileRevisionRecord,
  fileStatus,
  readWorkspaceConfigurationBundle,
  type PiConfigurationPaths,
  type WorkspaceConfigurationState
} from "./pi-configuration-file-state.js";
import {
  parseModelsDocument,
  parseSettingsDocument,
  projectProviderConfigurations
} from "./pi-configuration-documents.js";
import type { PiAuthCredentialStore } from "./pi-auth-credential-store.js";
import { reloadDesktopSettings } from "./desktop-package-toolchain.js";
import { withPiConfigurationBudget } from "./pi-configuration-service-options.js";
import { projectRuntimeProviders } from "./session-snapshot.js";

export interface ValidatedConfigurationRuntimeCandidate {
  runtime: ModelRuntime;
  modelsRevision: string;
  authRevision: string;
  onAuthRevisionMismatch?(content: string | undefined): void;
}

export function currentValidatedRuntimeCandidate(
  runtime: ModelRuntime | undefined,
  state: WorkspaceConfigurationState,
  bundle: Awaited<ReturnType<typeof readWorkspaceConfigurationBundle>>
): ValidatedConfigurationRuntimeCandidate | undefined {
  if (
    !runtime
    || state.snapshot?.syncState !== "current"
    || state.snapshot.revision !== bundle.revision
  ) return undefined;
  return {
    runtime,
    modelsRevision: bundle.byKind.models.revision,
    authRevision: bundle.byKind.auth.revision
  };
}

interface RefreshPiConfigurationOptions {
  states: WorkspaceConfigurationState[];
  paths: PiConfigurationPaths;
  credentials: PiAuthCredentialStore;
  source: PiConfigurationChangeSource;
  emit: boolean;
  force: boolean;
  runtimeReloadWaitMs: number;
  fileAccessWaitMs: number;
  validationRuntimeWaitMs: number;
  settingsReloadWaitMs: number;
  validatedRuntime?: ValidatedConfigurationRuntimeCandidate;
  createValidationRuntime(): Promise<ModelRuntime>;
  installModelRuntime(runtime: ModelRuntime): void;
}

export async function refreshPiConfigurationProjection(options: RefreshPiConfigurationOptions): Promise<void> {
  if (options.states.length === 0) return;
  const bundles = await Promise.all(options.states.map((state) => (
    readWorkspaceConfigurationBundle(options.paths, state, options.fileAccessWaitMs)
  )));
  if (
    !options.force
    && bundles.every((bundle, index) => options.states[index]?.snapshot?.revision === bundle.revision)
  ) return;

  const global = bundles[0]!;
  const validatedRuntime = options.validatedRuntime;
  if (
    validatedRuntime?.onAuthRevisionMismatch
    && validatedRuntime.authRevision !== global.byKind.auth.revision
  ) {
    validatedRuntime.onAuthRevisionMismatch(global.byKind.auth.content);
    throw new RuntimeError(
      "CONFIGURATION_CHANGED_EXTERNALLY",
      "Pi auth.json changed again while Desktop was validating the saved credential.",
      { recoverable: true }
    );
  }
  const globalDiagnostics: Array<{ file: PiConfigurationFileKind; message: string }> = [];
  let modelsDocument: ReturnType<typeof parseModelsDocument> | undefined;
  let globalSettings: ReturnType<typeof parseSettingsDocument> | undefined;
  let refreshedRuntime: ModelRuntime | undefined;
  try {
    modelsDocument = parseModelsDocument(global.byKind.models.content);
  } catch (error) {
    globalDiagnostics.push({ file: "models", message: configurationErrorMessage(error) });
  }
  const authError = options.credentials.loadContent(global.byKind.auth.content);
  if (authError) globalDiagnostics.push({ file: "auth", message: authError });
  try {
    globalSettings = parseSettingsDocument(global.byKind["global-settings"].content);
  } catch (error) {
    globalDiagnostics.push({ file: "global-settings", message: configurationErrorMessage(error) });
  }

  if (modelsDocument && !authError) {
    try {
      const revisionsMatch = validatedRuntime
        && validatedRuntime.modelsRevision === global.byKind.models.revision
        && validatedRuntime.authRevision === global.byKind.auth.revision;
      const probe = revisionsMatch
        ? validatedRuntime.runtime
        : await withConfigurationProjectionBudget(
            options.createValidationRuntime(),
            options.validationRuntimeWaitMs,
            "provider-validation-runtime"
          );
      const error = probe.getError();
      if (error) throw new Error(error);
      options.installModelRuntime(probe);
      refreshedRuntime = probe;
    } catch (error) {
      globalDiagnostics.push({
        file: "models",
        message: `Pi could not load models.json: ${configurationErrorMessage(error)}`
      });
    }
  }

  const globalValid = globalDiagnostics.length === 0 && modelsDocument !== undefined && globalSettings !== undefined;
  const runtime = globalValid ? refreshedRuntime : undefined;
  const runtimeProviders = runtime ? projectRuntimeProviders(runtime) : undefined;
  const runtimeModels = runtime?.getModels();
  const credentials = globalValid
    ? (await options.credentials.list()).map((credential) => ({
        provider: credential.providerId,
        type: credential.type
      }))
    : undefined;

  for (let index = 0; index < options.states.length; index += 1) {
    const state = options.states[index]!;
    const bundle = bundles[index]!;
    const diagnostics: Array<{ file: PiConfigurationFileKind; message: string }> = [
      ...globalDiagnostics
    ];
    let projectSettings: ReturnType<typeof parseSettingsDocument> | undefined;
    if (state.projectTrusted) {
      try {
        projectSettings = parseSettingsDocument(bundle.byKind["project-settings"].content);
      } catch (error) {
        diagnostics.push({ file: "project-settings", message: configurationErrorMessage(error) });
      }
    }
    if (diagnostics.length === 0) {
      try {
        await withConfigurationProjectionBudget(
          reloadDesktopSettings(state.settingsManager),
          options.settingsReloadWaitMs,
          "settings-reload"
        );
      } catch (error) {
        diagnostics.push({ file: "global-settings", message: configurationErrorMessage(error) });
      }
      for (const item of state.settingsManager.drainErrors()) {
        diagnostics.push({
          file: item.scope === "global" ? "global-settings" : "project-settings",
          message: item.error.message
        });
      }
    }

    const changedFiles = changedConfigurationFiles(state.fileRevisions, bundle.byKind);
    state.fileRevisions = fileRevisionRecord(bundle.byKind);
    const files = bundle.paths.map((pathState) => fileStatus(
      pathState,
      !diagnostics.some((diagnostic) => diagnostic.file === pathState.kind)
    ));
    let taskReload: PiConfigurationReloadState = "not-loaded";
    if (
      diagnostics.length === 0
      && modelsDocument
      && globalSettings
      && runtimeProviders
      && runtimeModels
      && credentials
    ) {
      const reloads = await Promise.all([...state.runtimes].map((target) => (
        requestBoundedRuntimeReload(
          target,
          bundle.revision,
          options.source === "catalog",
          options.runtimeReloadWaitMs
        )
      )));
      taskReload = reloads.includes("pending")
        ? "pending"
        : reloads.includes("applied") ? "applied" : "not-loaded";
      const effectiveProject = state.projectTrusted ? projectSettings?.selection : undefined;
      const projectVision = state.projectTrusted ? projectSettings?.visionAssistant : undefined;
      const globalVision = globalSettings.visionAssistant?.mode === "model"
        ? globalSettings.visionAssistant
        : undefined;
      const effectiveVision = projectVision?.mode === "model"
        ? projectVision
        : projectVision?.mode === "disabled" ? undefined : globalVision;
      state.snapshot = {
        revision: bundle.revision,
        syncState: "current",
        updatedAt: Date.now(),
        providers: projectProviderConfigurations(modelsDocument, runtimeProviders, runtimeModels),
        credentials,
        defaults: {
          ...(globalSettings.selection ? { global: globalSettings.selection } : {}),
          ...(effectiveProject ? { project: effectiveProject } : {}),
          ...(effectiveProject ?? globalSettings.selection
            ? { effective: effectiveProject ?? globalSettings.selection! }
            : {}),
          projectTrusted: state.projectTrusted
        },
        vision: {
          ...(globalVision ? { global: { provider: globalVision.provider, model: globalVision.model } } : {}),
          ...(projectVision ? { project: projectVision } : {}),
          ...(effectiveVision ? { effective: { provider: effectiveVision.provider, model: effectiveVision.model } } : {}),
          disabledByProject: projectVision?.mode === "disabled",
          projectTrusted: state.projectTrusted
        },
        files,
        diagnostics: []
      };
    } else {
      const previous = state.snapshot;
      state.snapshot = {
        revision: bundle.revision,
        syncState: "invalid",
        updatedAt: Date.now(),
        providers: previous?.providers ?? [],
        credentials: previous?.credentials ?? [],
        defaults: previous?.defaults ?? { projectTrusted: state.projectTrusted },
        vision: previous?.vision ?? {
          disabledByProject: false,
          projectTrusted: state.projectTrusted
        },
        files,
        diagnostics
      };
    }
    if (options.emit && (options.force || changedFiles.length > 0)) {
      const change: PiProviderConfigurationChanged = {
        snapshot: state.snapshot,
        source: options.source,
        changedFiles,
        taskReload
      };
      state.listeners.forEach((listener) => listener(change));
    }
  }
}

async function withConfigurationProjectionBudget<T>(
  operation: Promise<T>,
  waitMs: number,
  stage: "provider-validation-runtime" | "settings-reload"
): Promise<T> {
  return withPiConfigurationBudget(operation, waitMs, stage);
}

async function requestBoundedRuntimeReload(
  target: {
    requestConfigurationReload(revision: string): Promise<PiConfigurationReloadState>;
    requestModelCatalogReload(): Promise<PiConfigurationReloadState>;
  },
  revision: string,
  catalogOnly: boolean,
  waitMs: number
): Promise<PiConfigurationReloadState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<PiConfigurationReloadState>((resolve) => {
    timer = setTimeout(() => resolve("pending"), waitMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      catalogOnly
        ? target.requestModelCatalogReload()
        : target.requestConfigurationReload(revision),
      pending
    ]);
  } catch {
    return "pending";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
