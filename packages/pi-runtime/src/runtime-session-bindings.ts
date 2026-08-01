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
import { RuntimeError, type ExtensionUiCancellationReason } from "@pi67/domain";
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
import {
  createDesktopToolAliasBinding,
  type DesktopToolAliasBinding
} from "./tool-routing-extension.js";
import type { PromptAttachmentAccess } from "./prompt-attachment.js";

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
  requestApproval: DesktopApprovalRequester;
  recordToolAuthorization: DesktopToolAuthorizationRecorder;
  setSessionCwd: (cwd: string) => void;
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

  constructor(private readonly options: RuntimeSessionBindingsOptions) {}

  get runtime(): AgentSessionRuntime | undefined { return this.activeRuntime; }
  get session(): AgentSession | undefined { return this.activeRuntime?.session; }
  get services(): AgentSessionServices | undefined { return this.activeServices; }
  get settingsManager(): SettingsManager | undefined { return this.activeSettingsManager; }
  get extensions(): LoadExtensionsResult | undefined { return this.activeExtensions; }
  get sessionGeneration(): number { return this.generation; }

  refreshExtensions(): LoadExtensionsResult | undefined {
    this.activeExtensions = this.activeServices?.resourceLoader.getExtensions();
    this.activeToolAliases?.reconcile();
    return this.activeExtensions;
  }

  async createInitial(cwd: string, sessionManager?: SessionManager): Promise<void> {
    const services = await this.createServices(cwd);
    const toolAliases = createDesktopToolAliasBinding();
    const result = sessionManager
      ? await createAgentSessionFromServices({ services, sessionManager, customTools: toolAliases.tools })
      : await createAgentSession({
        cwd,
        agentDir: this.options.getAgentDir(),
        modelRuntime: services.modelRuntime,
        settingsManager: services.settingsManager,
        resourceLoader: services.resourceLoader,
        customTools: toolAliases.tools
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
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        customTools: toolAliases.tools,
        ...(sessionStartEvent ? { sessionStartEvent } : {})
      });
      toolAliases.bind(result.session);
      this.activeToolAliases = toolAliases;
      return { ...result, services, diagnostics: services.diagnostics };
    };
  }

  private async createServices(cwd: string): Promise<AgentSessionServices> {
    const workspaceServices = this.options.getWorkspaceServices();
    const promptAttachmentAccess = this.options.getPromptAttachmentAccess();
    workspaceServices?.assertCompatible(cwd, this.options.getAgentDir());
    const modelRuntime = await workspaceServices?.configurationService?.createModelRuntime();
    return createDesktopSessionServices({
      cwd,
      agentDir: this.options.getAgentDir(),
      runtimeCredentialOverrides: this.options.getRuntimeCredentialOverrides(),
      ...(workspaceServices === undefined
        ? {}
        : { settingsManager: workspaceServices.settingsManager }),
      ...(modelRuntime === undefined ? {} : { modelRuntime }),
      getSafety: this.options.getSafety,
      requestApproval: this.options.requestApproval,
      recordToolAuthorization: this.options.recordToolAuthorization,
      ...(promptAttachmentAccess === undefined ? {} : { promptAttachmentAccess })
    });
  }

  private async bindSession(session: AgentSession): Promise<void> {
    // Advance authority before extension hooks run so no event is attributed to the previous session.
    this.generation += 1;
    this.activeServices = this.requireRuntime().services;
    this.activeSettingsManager = this.activeServices.settingsManager;
    this.activeExtensions = this.activeServices.resourceLoader.getExtensions();
    this.options.setSessionCwd(session.sessionManager.getCwd());
    const unsubscribe = session.subscribe((event) => {
      this.options.projections.observe(session, event);
    });
    this.sessionUnsubscribe = unsubscribe;
    try {
      // Subscribe before the first await so async session_start mutations cannot
      // land between the initial projection snapshot and event observation.
      await this.options.projections.bind(session, this.activeExtensions);
      await this.options.rebindExtensionUi(session);
      this.options.emit({ type: "extension.catalog.changed", payload: this.options.projections.getCatalog() });
      await this.options.externalChangeGuard.bind(session, this.generation, this.options.emit);
    } catch (error) {
      if (this.sessionUnsubscribe === unsubscribe) {
        unsubscribe();
        this.sessionUnsubscribe = undefined;
      }
      this.options.externalChangeGuard.detach();
      this.options.projections.reset();
      throw error;
    }
  }

  private detachSessionBindings(): void {
    this.options.externalChangeGuard.detach();
    this.sessionUnsubscribe?.();
    this.sessionUnsubscribe = undefined;
    this.options.projections.reset();
    this.options.cancelInteractiveRequests("session-transition");
  }
}
