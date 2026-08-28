import {
  AgentSessionRuntime,
  createAgentSession,
  createAgentSessionFromServices,
  type AgentSession,
  type AgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type LoadExtensionsResult,
  type SessionManager,
  type SettingsManager
} from "@earendil-works/pi-coding-agent";
import { realpath, stat, writeFile } from "node:fs/promises";
import {
  RuntimeError,
  type ExtensionUiCancellationReason,
  type NativeSubagentLineage,
  type PlanImplementationRequestLineage
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import type { RuntimeProjectionController } from "./runtime-projection-controller.js";
import type { RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import type {
  DesktopApprovalRequester,
  DesktopToolAuthorizationRecorder,
  SafetyPolicyState
} from "./safety-extension.js";
import { createDesktopSessionServices } from "./session-services.js";
import type { SessionExternalChangeGuard } from "./session-external-change-guard.js";
import type { PiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";
import type { RuntimeInitializationObserver } from "./agent-runtime.js";
import { runRuntimeInitializationStage } from "./runtime-initialization-observer.js";
import {
  createDesktopToolAliasBinding,
  type DesktopToolAliasBinding
} from "./tool-routing-extension.js";
import type { PromptAttachmentAccess } from "./prompt-attachment.js";
import { resolveExistingSessionFileIdentity } from "./session-path-identity.js";
import { createFirstPartyWebTools } from "./first-party-web-tools.js";
import { PlanModeController } from "./plan-mode-controller.js";
import type { SessionInteractionMode, SessionInteractionState } from "@pi67/domain";
import {
  NativeSubagentCoordinator,
  type NativeSubagentSessionFactoryInput,
  type NativeSubagentSessionHandle
} from "./native-subagent-coordinator.js";
import { createNativeSubagentTools } from "./native-subagent-tools.js";

const DESKTOP_EXCLUDED_SDK_TOOLS = ["powershell"];

interface RuntimeSessionBindingsOptions {
  cancelInteractiveRequests: (reason: ExtensionUiCancellationReason) => void;
  emit: (event: AgentEvent) => void;
  externalChangeGuard: SessionExternalChangeGuard;
  getAgentDir: () => string;
  getRuntimeCredentialOverrides: () => RuntimeCredentialOverrideStore;
  getSafety: () => SafetyPolicyState;
  getWorkspaceServices: () => PiWorkspaceRuntimeServices | undefined;
  getPromptAttachmentAccess: () => PromptAttachmentAccess | undefined;
  projections: RuntimeProjectionController;
  rebindExtensionUi: (session: AgentSession) => Promise<void>;
  bindChildExtensionUi: (session: AgentSession, lineage: NativeSubagentLineage) => Promise<void>;
  requestApproval: DesktopApprovalRequester;
  recordToolAuthorization: DesktopToolAuthorizationRecorder;
  setSessionCwd: (cwd: string) => void;
  subagents: NativeSubagentCoordinator;
}

/** Owns the mutable Pi SDK session runtime and all bindings tied to its current session. */
export class RuntimeSessionBindings {
  private activeRuntime: AgentSessionRuntime | undefined;
  private activeServices: AgentSessionServices | undefined;
  private activeSettingsManager: SettingsManager | undefined;
  private activeExtensions: LoadExtensionsResult | undefined;
  private activeToolAliases: DesktopToolAliasBinding | undefined;
  private sessionUnsubscribe: (() => void) | undefined;
  private transition: Promise<unknown> | undefined;
  private generation = 0;
  private activeSessionFileIdentity: string | undefined;
  private readonly planMode: PlanModeController;

  constructor(private readonly options: RuntimeSessionBindingsOptions) {
    this.planMode = new PlanModeController(options.emit);
  }

  get runtime(): AgentSessionRuntime | undefined { return this.activeRuntime; }
  get session(): AgentSession | undefined { return this.activeRuntime?.session; }
  get services(): AgentSessionServices | undefined { return this.activeServices; }
  get settingsManager(): SettingsManager | undefined { return this.activeSettingsManager; }
  get extensions(): LoadExtensionsResult | undefined { return this.activeExtensions; }
  get sessionGeneration(): number { return this.generation; }
  get sessionFileIdentity(): string | undefined { return this.activeSessionFileIdentity; }
  get interactionMode(): SessionInteractionMode { return this.planMode.interactionMode; }
  get interactionState(): SessionInteractionState { return this.planMode.snapshot(); }

  setInteractionMode(mode: SessionInteractionMode): void { this.planMode.setInteractionMode(mode); }
  implementPlan(planId: string, lineage: PlanImplementationRequestLineage): Promise<void> {
    const session = this.session;
    if (
      !session
      || lineage.sessionId !== session.sessionId
      || lineage.sessionFileIdentity !== this.activeSessionFileIdentity
      || lineage.sessionGeneration !== this.generation
    ) {
      throw new RuntimeError(
        "SESSION_CHANGED_EXTERNALLY",
        "The Plan implementation no longer belongs to the active Pi Session."
      );
    }
    return this.planMode.implementPlan(planId, lineage);
  }

  refreshExtensions(): LoadExtensionsResult | undefined {
    this.activeExtensions = this.activeServices?.resourceLoader.getExtensions();
    this.activeToolAliases?.reconcile();
    return this.activeExtensions;
  }

  async createInitial(
    cwd: string,
    sessionManager?: SessionManager,
    observeStage?: RuntimeInitializationObserver
  ): Promise<void> {
    const services = await this.createServices(cwd, observeStage);
    await runRuntimeInitializationStage(observeStage, "activate-session", async () => {
      const toolAliases = createDesktopToolAliasBinding();
      const customTools = [
        ...createFirstPartyWebTools(),
        ...this.planMode.createTools(),
        ...createNativeSubagentTools(this.options.subagents),
        ...toolAliases.tools
      ];
      const result = sessionManager
        ? await createAgentSessionFromServices({
            services,
            sessionManager,
            customTools,
            excludeTools: DESKTOP_EXCLUDED_SDK_TOOLS
          })
        : await createAgentSession({
          cwd,
          agentDir: this.options.getAgentDir(),
          modelRuntime: services.modelRuntime,
          settingsManager: services.settingsManager,
          resourceLoader: services.resourceLoader,
          customTools,
          excludeTools: DESKTOP_EXCLUDED_SDK_TOOLS
        });
      toolAliases.bind(result.session);
      this.activeToolAliases = toolAliases;
      const runtime = new AgentSessionRuntime(
        result.session,
        services,
        this.createRuntimeFactory(),
        services.diagnostics,
        result.modelFallbackMessage
      );
      this.activeRuntime = runtime;
      runtime.setBeforeSessionInvalidate(() => this.detachSessionBindings());
      runtime.setRebindSession((session) => this.bindSession(session));
      await this.bindSession(result.session);
    });
  }

  async settleAndDispose(): Promise<void> {
    await this.transition?.catch(() => undefined);
    await this.disposeRuntime();
  }

  async disposeRuntime(): Promise<void> {
    const runtime = this.activeRuntime;
    if (!runtime) {
      this.options.externalChangeGuard.detach();
      this.options.projections.reset();
      this.planMode.unbind();
      return;
    }
    if (runtime.session.isStreaming) await runtime.session.abort();
    await runtime.dispose();
    this.activeRuntime = undefined;
    this.options.projections.reset();
    this.activeServices = undefined;
    this.activeSettingsManager = undefined;
    this.activeExtensions = undefined;
    this.activeToolAliases = undefined;
    this.activeSessionFileIdentity = undefined;
  }

  requireSession(): AgentSession {
    return this.requireRuntime().session;
  }

  requireRuntime(): AgentSessionRuntime {
    if (!this.activeRuntime) {
      throw new RuntimeError("RUNTIME_NOT_READY", "Pi SDK runtime is not initialized.");
    }
    return this.activeRuntime;
  }

  async runTransition<T>(operation: () => Promise<T>): Promise<T> {
    if (this.transition) {
      throw new RuntimeError("BUSY", "Another Pi session transition is already in progress.", {
        details: { retryable: true }
      });
    }
    const transition = Promise.resolve().then(operation);
    this.transition = transition;
    try {
      return await transition;
    } finally {
      if (this.transition === transition) this.transition = undefined;
    }
  }

  private createRuntimeFactory(): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await this.createServices(cwd);
      const toolAliases = createDesktopToolAliasBinding();
      const customTools = [
        ...createFirstPartyWebTools(),
        ...this.planMode.createTools(),
        ...createNativeSubagentTools(this.options.subagents),
        ...toolAliases.tools
      ];
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        customTools,
        excludeTools: DESKTOP_EXCLUDED_SDK_TOOLS,
        ...(sessionStartEvent ? { sessionStartEvent } : {})
      });
      toolAliases.bind(result.session);
      this.activeToolAliases = toolAliases;
      return { ...result, services, diagnostics: services.diagnostics };
    };
  }

  private async createServices(
    cwd: string,
    observeStage?: RuntimeInitializationObserver,
    subagent?: NativeSubagentLineage
  ): Promise<AgentSessionServices> {
    const workspaceServices = this.options.getWorkspaceServices();
    const promptAttachmentAccess = this.options.getPromptAttachmentAccess();
    workspaceServices?.assertCompatible(cwd, this.options.getAgentDir());
    const configurationService = workspaceServices?.configurationService;
    const modelRuntimeLoad = configurationService
      ? runRuntimeInitializationStage(
          observeStage,
          "load-model-runtime",
          () => configurationService.createModelRuntime()
        )
      : Promise.resolve(undefined);
    const packageTrustRefresh = workspaceServices?.packageTrustRegistry.refresh();
    const packageTrustLoad = packageTrustRefresh
      ? runRuntimeInitializationStage(
          observeStage,
          "validate-packages",
          () => packageTrustRefresh
        )
      : Promise.resolve();
    const [modelRuntime] = await Promise.all([modelRuntimeLoad, packageTrustLoad]);
    return runRuntimeInitializationStage(observeStage, "load-session-resources", () => (
      createDesktopSessionServices({
        cwd,
        agentDir: this.options.getAgentDir(),
        runtimeCredentialOverrides: this.options.getRuntimeCredentialOverrides(),
        ...(workspaceServices === undefined
          ? {}
          : {
              settingsManager: workspaceServices.settingsManager,
              packageTrustRegistry: workspaceServices.packageTrustRegistry
            }),
        ...(packageTrustRefresh === undefined ? {} : { packageTrustRefresh }),
        ...(modelRuntime === undefined ? {} : { modelRuntime }),
        getSafety: this.options.getSafety,
        requestApproval: subagent === undefined
          ? this.options.requestApproval
          : (request, approvalOptions) => this.options.requestApproval(
              { ...request, subagent },
              approvalOptions
            ),
        recordToolAuthorization: this.options.recordToolAuthorization,
        getInteractionMode: () => this.planMode.interactionMode,
        ...(promptAttachmentAccess === undefined ? {} : { promptAttachmentAccess }),
        ...(subagent === undefined ? {} : { noThirdPartyExtensions: true })
      })
    ));
  }

  async createSubagentSession(
    input: NativeSubagentSessionFactoryInput
  ): Promise<NativeSubagentSessionHandle> {
    const cwd = input.sessionManager.getCwd();
    const services = await this.createServices(cwd, undefined, input.lineage);
    const requestedModel = input.requestedModel === undefined
      ? undefined
      : services.modelRuntime.getModel(input.requestedModel.provider, input.requestedModel.id);
    if (input.requestedModel !== undefined && requestedModel === undefined) {
      throw new RuntimeError(
        "INVALID_PAYLOAD",
        "The requested native subagent model is not available in this Pi Agent Profile."
      );
    }
    const toolAliases = createDesktopToolAliasBinding();
    const customTools = [
      ...createFirstPartyWebTools(),
      ...createNativeSubagentTools(this.options.subagents, {
        parentChildId: input.lineage.childId,
        depth: input.lineage.depth
      }),
      ...toolAliases.tools
    ];
    const selectedModel = requestedModel ?? input.parentModel;
    const result = await createAgentSessionFromServices({
      services,
      sessionManager: input.sessionManager,
      customTools,
      excludeTools: DESKTOP_EXCLUDED_SDK_TOOLS,
      ...(selectedModel === undefined ? {} : { model: selectedModel }),
      thinkingLevel: input.thinkingLevel
    });
    toolAliases.bind(result.session);
    await this.options.bindChildExtensionUi(result.session, input.lineage);
    const runtime = new AgentSessionRuntime(
      result.session,
      services,
      async () => {
        throw new RuntimeError("UNSUPPORTED", "Child Pi Session replacement is not exposed by native subagents.");
      },
      services.diagnostics,
      result.modelFallbackMessage
    );
    return {
      session: result.session,
      dispose: () => runtime.dispose()
    };
  }

  private async bindSession(session: AgentSession): Promise<void> {
    await this.materializeSession(session.sessionManager);
    this.activeSessionFileIdentity = await this.resolveSessionFileIdentity(session.sessionManager);
    // Advance authority before extension hooks run so no event is attributed to the previous session.
    this.generation += 1;
    this.activeServices = this.requireRuntime().services;
    this.activeSettingsManager = this.activeServices.settingsManager;
    this.activeExtensions = this.activeServices.resourceLoader.getExtensions();
    this.options.setSessionCwd(session.sessionManager.getCwd());
    const unsubscribe = session.subscribe((event) => {
      this.planMode.observeSessionEvent(session, event);
      this.options.projections.observe(session, event);
    });
    this.sessionUnsubscribe = unsubscribe;
    try {
      // Subscribe before the first await so async session_start mutations cannot
      // land between the initial projection snapshot and event observation.
      await this.options.projections.bind(session, this.activeExtensions);
      this.planMode.bind(session);
      await this.options.subagents.bindParent(session);
      await this.options.rebindExtensionUi(session);
      this.activeToolAliases?.reconcile();
      this.options.emit({ type: "extension.catalog.changed", payload: this.options.projections.getCatalog() });
      await this.options.externalChangeGuard.bind(session, this.generation, this.options.emit);
    } catch (error) {
      if (this.sessionUnsubscribe === unsubscribe) {
        unsubscribe();
        this.sessionUnsubscribe = undefined;
      }
      this.options.externalChangeGuard.detach();
      this.options.projections.reset();
      this.planMode.unbind();
      this.options.subagents.detachParent();
      this.activeSessionFileIdentity = undefined;
      throw error;
    }
  }

  private async materializeSession(sessionManager: SessionManager): Promise<void> {
    const sessionPath = sessionManager.getSessionFile();
    if (!sessionManager.isPersisted() || !sessionPath) return;

    const existing = await stat(sessionPath).catch((error: unknown) => {
      if (isFileSystemError(error, "ENOENT")) return undefined;
      throw error;
    });
    if (existing) {
      if (existing.size === 0) {
        throw new Error(`Pi Session file is empty and cannot be published: ${sessionPath}`);
      }
      return;
    }

    const header = sessionManager.getHeader();
    if (!header) throw new Error("Pi Session cannot be persisted without a header.");
    const content = [header, ...sessionManager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    await writeFile(sessionPath, `${content}\n`, { encoding: "utf8", flag: "wx" });

    // Reopen through Pi so its append state matches the newly materialized file.
    sessionManager.setSessionFile(await realpath(sessionPath));
  }

  private async resolveSessionFileIdentity(sessionManager: SessionManager): Promise<string | undefined> {
    const sessionPath = sessionManager.getSessionFile();
    return sessionPath ? resolveExistingSessionFileIdentity(sessionPath) : undefined;
  }

  private detachSessionBindings(): void {
    this.options.externalChangeGuard.detach();
    this.sessionUnsubscribe?.();
    this.sessionUnsubscribe = undefined;
    this.options.projections.reset();
    this.options.cancelInteractiveRequests("session-transition");
    this.planMode.unbind();
    this.options.subagents.detachParent();
  }
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
