import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  RuntimeError,
  type SessionResourceCatalogResult,
  type SessionSnapshot
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import type { RuntimeInitializationObserver, RuntimeInitializeOptions } from "./agent-runtime.js";
import { refreshConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";
import { refreshLoadedResourceReadAccess } from "./loaded-resource-read-access.js";
import { PiRuntimeConfigurationReload } from "./pi-runtime-configuration-reload.js";
import { RuntimeProjectionController } from "./runtime-projection-controller.js";
import { runRuntimeInitializationStage } from "./runtime-initialization-observer.js";
import { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import type { RuntimeSessionCatalog } from "./runtime-session-catalog.js";
import {
  appendSessionCreationMarker,
  SessionCreationReceiptStore,
  type SessionCreationManager
} from "./session-creation-receipt-store.js";
import { resolveManagedSessionPath } from "./session-import.js";
import {
  projectSessionControls,
  projectSessionModelCatalog,
  projectSessionResources
} from "./session-snapshot.js";
import { RuntimeToolSafetyController } from "./runtime-tool-safety-controller.js";
import type { PiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";

interface PiSdkRuntimeSessionLifecycleOptions {
  sessionBindings: RuntimeSessionBindings;
  sessionCatalog: RuntimeSessionCatalog;
  configurationReload: PiRuntimeConfigurationReload;
  toolSafety: RuntimeToolSafetyController;
  projections: RuntimeProjectionController;
  workspaceServices?: PiWorkspaceRuntimeServices;
  getAgentDir(): string;
  setAgentDir(agentDir: string): void;
  cancelInteractiveRequests(reason: "runtime-dispose" | "session-transition" | "resource-reload"): void;
  dropStream(): void;
  getSnapshot(): SessionSnapshot;
  getExtensionCatalog(): ReturnType<RuntimeProjectionController["getCatalog"]>;
  assertSessionWritable(): Promise<void>;
  emit(event: AgentEvent): void;
}

export class PiSdkRuntimeSessionLifecycle {
  constructor(private readonly options: PiSdkRuntimeSessionLifecycleOptions) {}

  async initialize(
    input: RuntimeInitializeOptions,
    observeStage?: RuntimeInitializationObserver
  ): Promise<SessionSnapshot> {
    return this.options.sessionBindings.runTransition(async () => {
      let creationMaterialized = false;
      try {
        this.options.cancelInteractiveRequests("runtime-dispose");
        const nextAgentDir = input.agentDir ?? getAgentDir();
        this.options.workspaceServices?.assertCompatible(input.cwd, nextAgentDir);
        const sessionManager = await runRuntimeInitializationStage(observeStage, "resolve-session", async () => {
          const sessionPath = input.sessionPath
            ? await resolveManagedSessionPath(input.sessionPath, input.cwd, nextAgentDir)
            : undefined;
          return sessionPath ? SessionManager.open(sessionPath, undefined, input.cwd) : undefined;
        });
        if (input.creationId && sessionManager) {
          throw new RuntimeError(
            "INVALID_PAYLOAD",
            "A Session creation bootstrap cannot resume an existing Pi Session."
          );
        }
        await runRuntimeInitializationStage(
          observeStage,
          "dispose-current",
          () => this.options.sessionBindings.disposeRuntime()
        );
        this.options.setAgentDir(nextAgentDir);
        this.options.toolSafety.initialize(input.cwd, input.trust, input.approvalMode);
        this.options.workspaceServices?.setProjectTrusted(input.trust === "trusted");
        await runRuntimeInitializationStage(observeStage, "create-session", async () => {
          await this.options.sessionBindings.createInitial(input.cwd, sessionManager);
          if (!input.creationId) return;
          const manager = this.options.sessionBindings.requireSession().sessionManager;
          await appendSessionCreationMarker(manager, input.creationId);
          creationMaterialized = true;
          await this.creationReceipts(manager).record(input.creationId, manager);
        });
        await runRuntimeInitializationStage(
          observeStage,
          "reload-configuration",
          () => this.options.configurationReload.apply()
        );
        await runRuntimeInitializationStage(
          observeStage,
          "update-catalog",
          () => this.options.sessionCatalog.upsertCurrent(
            input.creationId ? "session-created" : "session-updated"
          )
        );
        return runRuntimeInitializationStage(
          observeStage,
          "project-snapshot",
          () => this.options.getSnapshot()
        );
      } catch (error) {
        if (!input.creationId || !creationMaterialized) throw error;
        throw sessionCreationOutcomeUnknown(input.creationId);
      }
    });
  }

  async create(creationId: string): Promise<SessionSnapshot> {
    return this.options.sessionBindings.runTransition(async () => {
      let materialized = false;
      try {
        this.options.cancelInteractiveRequests("session-transition");
        this.options.dropStream();
        let createdManager: SessionCreationManager | undefined;
        const result = await this.options.sessionBindings.requireRuntime().newSession({
          setup: async (manager) => {
            await appendSessionCreationMarker(manager, creationId);
            createdManager = manager;
            materialized = true;
          }
        });
        if (result.cancelled) throw new Error("A Pi extension cancelled the new session.");
        if (!createdManager) throw new Error("The Pi Session creation marker was not installed.");
        await this.creationReceipts(createdManager).record(creationId, createdManager);
        await this.options.sessionCatalog.upsertCurrent("session-created");
        await this.options.configurationReload.apply();
        return this.options.getSnapshot();
      } catch (error) {
        if (!materialized) throw error;
        throw sessionCreationOutcomeUnknown(creationId);
      }
    });
  }

  async reloadResources(): Promise<SessionResourceCatalogResult> {
    return this.options.sessionBindings.runTransition(async () => {
      await this.options.assertSessionWritable();
      this.options.cancelInteractiveRequests("resource-reload");
      this.options.projections.resetExtensionAdapters();
      const generationBeforeReload = this.options.sessionBindings.sessionGeneration;
      await this.options.sessionBindings.requireSession().reload();
      const services = this.options.sessionBindings.services;
      if (services) {
        await Promise.all([
          refreshLoadedResourceReadAccess(services.resourceLoader),
          refreshConfiguredCapabilityCatalog(services.resourceLoader)
        ]);
      }
      if (this.options.sessionBindings.sessionGeneration === generationBeforeReload) {
        const extensions = this.options.sessionBindings.refreshExtensions();
        await this.options.projections.refreshExtensionAdapters(
          this.options.sessionBindings.requireSession(),
          extensions
        );
        this.options.emit({
          type: "extension.catalog.changed",
          payload: this.options.getExtensionCatalog()
        });
      }
      this.options.emit({ type: "resource.changed", payload: { reason: "reload" } });
      const session = this.options.sessionBindings.requireSession();
      return {
        sessionId: session.sessionId,
        controls: projectSessionControls(session),
        modelCatalog: projectSessionModelCatalog(session),
        resources: projectSessionResources(
          this.options.sessionBindings.services,
          this.options.sessionBindings.extensions
        )
      };
    });
  }

  private creationReceipts(manager: SessionCreationManager): SessionCreationReceiptStore {
    return this.options.workspaceServices?.sessionCreationReceipts
      ?? new SessionCreationReceiptStore({
        cwd: manager.getCwd(),
        agentDir: this.options.getAgentDir(),
        getConfiguredSessionDir: () => this.options.sessionBindings.settingsManager?.getSessionDir(),
        ...(process.env.PI67_STORAGE_ROOT === undefined
          ? {}
          : { storageRoot: process.env.PI67_STORAGE_ROOT })
      });
  }
}

function sessionCreationOutcomeUnknown(creationId: string): RuntimeError {
  return new RuntimeError(
    "REQUEST_OUTCOME_UNKNOWN",
    "The Pi Session was created, but Desktop could not finish publishing its authoritative bootstrap.",
    { details: { creationId } }
  );
}
