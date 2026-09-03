import { randomUUID } from "node:crypto";
import { getAgentDir, VERSION } from "@earendil-works/pi-coding-agent";
import {
  type ApprovalMode, type ApprovalResolution, type ApprovalResponseDecision,
  type ConversationPage, type DoctorReport, type ExtensionCatalogResult,
  type ExtensionUiCancellationReason, type ModelSummary, type ResourceCatalogProjection,
  type RuntimeCapabilities, type RuntimeIdentity, type RuntimeOperationActivity,
  type SessionCatalogPage, type SessionCatalogQuery, type SessionCatalogStatus,
  type SessionControlResult, type SessionModelCatalogResult, type SessionResourceCatalogResult,
  type SessionSnapshot, type SessionTreeProjection, type SessionInteractionMode,
  type PlanImplementationRequestLineage,
  type TaskToolMode,
  type ToolExecutionView,
  type WorkspaceTrust,
  type NativeSubagentMode,
  type NativeSubagentView,
  type NativeSubagentWaitResult
} from "@pi67/domain";
import type { AgentEvent, AssetReadResult, PiConfigurationReloadState, SlashCommandCatalogResult,
  PromptAttachmentRef, RuntimeDiagnostics, StreamDelta } from "@pi67/protocol";
import type { AgentRuntime, RuntimeInitializationObserver, RuntimeInitializeOptions } from "./agent-runtime.js";
import { bindSessionExtensionUi, createSessionExtensionUiBridge } from "./extension-ui-lifecycle.js";
import { selectSessionModel, setSessionThinkingLevel } from "./model-control.js";
import { createRuntimeCredentialOverrideStore, type RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import { PiRuntimeConfigurationReload } from "./pi-runtime-configuration-reload.js";
import { RuntimeProjectionController } from "./runtime-projection-controller.js";
import { createRuntimeSessionCatalog, type RuntimeSessionCatalogTarget } from "./runtime-session-catalog.js";
import { RuntimeSessionTransitions } from "./runtime-session-transitions.js";
import { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import { SessionExternalChangeGuard } from "./session-external-change-guard.js";
import { projectSessionControls, projectSessionModelCatalogResult, projectSessionModels, projectSessionResourceCatalog } from "./session-snapshot.js";
import { StreamBatcher } from "./stream-batcher.js";
import type { PiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";
import type { PreparedPromptAttachmentSet, PromptAttachmentAccess } from "./prompt-attachment.js";
import { RuntimePromptAttachments } from "./runtime-prompt-attachments.js";
import { RuntimeToolSafetyController } from "./runtime-tool-safety-controller.js";
import { ToolAuthorizationTracker } from "./tool-authorization-tracker.js";
import { PiSdkRuntimeSessionLifecycle } from "./pi-sdk-runtime-session-lifecycle.js";
import { PiRuntimeSessionActions } from "./pi-runtime-session-actions.js";
import { PiRuntimeConversationActions } from "./pi-runtime-conversation-actions.js";
import { PiRuntimePromptActions } from "./pi-runtime-prompt-actions.js";
import { PiRuntimeEventBus } from "./pi-runtime-event-bus.js";
import {
  collectPiRuntimeDiagnostics,
  getPiRuntimeIdentity,
  runPiRuntimeDoctor
} from "./pi-runtime-observability.js";
import { NativeSubagentCoordinator } from "./native-subagent-coordinator.js";
import { NativeSubagentAdmission } from "./native-subagent-admission.js";
import type { PiSdkRuntimeOptions } from "./pi-sdk-runtime-options.js";
export type { PiSdkRuntimeOptions } from "./pi-sdk-runtime-options.js";

export class PiSdkRuntime implements AgentRuntime {
  private readonly events = new PiRuntimeEventBus();
  private readonly runtimeCredentialOverrides: RuntimeCredentialOverrideStore;
  private readonly ownsRuntimeCredentialOverrides: boolean;
  private readonly workspaceServices: PiWorkspaceRuntimeServices | undefined;
  private readonly promptAttachmentAccess: PromptAttachmentAccess | undefined;
  private readonly promptAttachments: RuntimePromptAttachments;
  private runtimeCredentialUnsubscribe: (() => void) | undefined;
  private configurationRuntimeUnsubscribe: (() => void) | undefined;
  private readonly configurationReload: PiRuntimeConfigurationReload;
  private readonly toolSafety = new RuntimeToolSafetyController();
  private readonly toolAuthorizations = new ToolAuthorizationTracker();
  private agentDir = getAgentDir();
  private readonly externalSessionChangeGuard = new SessionExternalChangeGuard();
  private readonly streamBatcher: StreamBatcher<StreamDelta>;
  private readonly projections: RuntimeProjectionController;
  private readonly sessionBindings: RuntimeSessionBindings;
  private readonly sessionCatalog: ReturnType<typeof createRuntimeSessionCatalog>;
  private readonly sessionTransitions: RuntimeSessionTransitions;
  private readonly sessionLifecycle: PiSdkRuntimeSessionLifecycle;
  private readonly conversationActions: PiRuntimeConversationActions;
  private readonly promptActions: PiRuntimePromptActions;
  private readonly subagents: NativeSubagentCoordinator;
  private uiBridge: ReturnType<typeof createSessionExtensionUiBridge>;

  constructor(options: PiSdkRuntimeOptions = {}) {
    this.workspaceServices = options.workspaceServices;
    this.promptAttachmentAccess = options.promptAttachmentAccess;
    this.promptAttachments = new RuntimePromptAttachments(this.promptAttachmentAccess, async (cwd) => (
      await this.workspaceServices?.configurationService?.get(cwd)
    )?.vision.effective);
    this.ownsRuntimeCredentialOverrides = options.runtimeCredentialOverrides === undefined;
    this.runtimeCredentialOverrides = options.runtimeCredentialOverrides
      ?? createRuntimeCredentialOverrideStore();
    this.uiBridge = createSessionExtensionUiBridge(
      (event) => this.events.emitAgent(event),
      () => this.sessionBindings?.session?.sessionId
    );
    this.streamBatcher = new StreamBatcher<StreamDelta>((events) => {
      this.events.emitAgent({ type: "turn.streamBatch", payload: { events } });
    });
    this.projections = new RuntimeProjectionController({
      getSession: () => this.sessionBindings.requireSession(),
      getSessionFileIdentity: () => this.sessionBindings.sessionFileIdentity,
      getSessionGeneration: () => this.sessionBindings.sessionGeneration,
      emit: (event) => this.events.emitAgent(event),
      emitActivity: (activity) => this.events.emitActivity(activity),
      emitToolExecution: (execution) => this.events.emitToolExecution(execution),
      getToolAuthorization: (toolCallId) => this.toolAuthorizations.get(toolCallId),
      completeToolAuthorization: (toolCallId) => this.toolAuthorizations.complete(toolCallId),
      resetToolAuthorizations: () => this.toolAuthorizations.reset(),
      pushStream: (delta) => this.streamBatcher.push(delta),
      flushStream: () => this.streamBatcher.flush()
    });
    this.subagents = new NativeSubagentCoordinator({
      admission: options.subagentAdmission ?? new NativeSubagentAdmission(),
      parentKey: options.subagentParentKey ?? `runtime-${randomUUID()}`,
      getAgentDir: () => this.agentDir,
      createSession: (input) => this.sessionBindings.createSubagentSession(input),
      emit: (item, reason) => this.events.emitAgent({
        type: "subagent.changed",
        payload: { item, reason }
      })
    });
    this.sessionBindings = new RuntimeSessionBindings({
      cancelInteractiveRequests: (reason) => { this.uiBridge.cancelAll(reason); },
      emit: (event) => this.events.emitAgent(event),
      externalChangeGuard: this.externalSessionChangeGuard,
      getAgentDir: () => this.agentDir,
      getRuntimeCredentialOverrides: () => this.runtimeCredentialOverrides,
      getSafety: () => this.toolSafety.policy,
      getWorkspaceServices: () => this.workspaceServices,
      getPromptAttachmentAccess: () => this.promptAttachmentAccess,
      projections: this.projections,
      rebindExtensionUi: async (session) => {
        this.uiBridge.dispose();
        this.uiBridge = createSessionExtensionUiBridge(
          (event) => this.events.emitAgent(event),
          () => this.sessionBindings.session?.sessionId
        );
        await bindSessionExtensionUi(session, this.uiBridge, (event) => this.events.emitAgent(event));
      },
      bindChildExtensionUi: async (session) => {
        await bindSessionExtensionUi(session, this.uiBridge, (event) => this.events.emitAgent(event));
      },
      requestApproval: (request, options) => this.uiBridge.requestApproval(request, options),
      recordToolAuthorization: (toolCallId, reason) => {
        this.toolAuthorizations.record(toolCallId, reason);
        const authorization = this.toolAuthorizations.get(toolCallId);
        if (authorization) this.projections.recordToolAuthorization(toolCallId, authorization);
      },
      setSessionCwd: (cwd) => this.toolSafety.setCwd(cwd),
      subagents: this.subagents,
      sharedExperienceAccess: options.sharedExperienceAccess,
      sharedSopAccess: options.sharedSopAccess
    });
    this.configurationReload = new PiRuntimeConfigurationReload({
      getSession: () => this.sessionBindings.session,
      emit: (event) => this.events.emitAgent(event)
    });
    const sessionCatalogTarget: RuntimeSessionCatalogTarget = {
      emit: (event) => this.events.emitAgent(event),
      getAgentDir: () => this.agentDir,
      getConfiguredSessionDir: () => this.sessionBindings.settingsManager?.getSessionDir(),
      getWorkspaceCwd: () => this.toolSafety.policy.cwd,
      getSessionManager: () => this.sessionBindings.session?.sessionManager,
      getSessionMetadata: (manager) => this.projections.getMetadata(manager)
    };
    this.sessionCatalog = this.workspaceServices
      ? this.workspaceServices.sessionCatalog.createBinding(sessionCatalogTarget)
      : createRuntimeSessionCatalog(
        process.env.PI67_SESSION_CATALOG_DIR,
        sessionCatalogTarget,
        process.env.PI67_STORAGE_ROOT
      );
    this.sessionTransitions = new RuntimeSessionTransitions({
      getCwd: () => this.toolSafety.policy.cwd,
      getAgentDir: () => this.agentDir,
      getSessionDirectory: () => this.sessionBindings.requireSession().sessionManager.getSessionDir(),
      getActiveSessionPath: () => this.getIdentity().sessionPath,
      prepare: async () => {
        this.uiBridge.cancelAll("session-transition");
        this.streamBatcher.drop();
        await this.assertSessionWritable();
      },
      switchSession: (path, cwdOverride) => this.sessionBindings.requireRuntime().switchSession(
        path,
        cwdOverride ? { cwdOverride } : undefined
      ),
      commit: async (reason) => {
        await this.sessionCatalog.upsertCurrent(reason);
        await this.configurationReload.apply();
        return this.getSnapshot();
      }
    });
    this.sessionLifecycle = new PiSdkRuntimeSessionLifecycle({
      sessionBindings: this.sessionBindings,
      sessionCatalog: this.sessionCatalog,
      configurationReload: this.configurationReload,
      toolSafety: this.toolSafety,
      projections: this.projections,
      ...(this.workspaceServices ? { workspaceServices: this.workspaceServices } : {}),
      getAgentDir: () => this.agentDir,
      setAgentDir: (agentDir) => { this.agentDir = agentDir; },
      cancelInteractiveRequests: (reason) => this.uiBridge.cancelAll(reason),
      dropStream: () => this.streamBatcher.drop(),
      getSnapshot: () => this.getSnapshot(),
      getExtensionCatalog: () => this.getExtensionCatalog(),
      assertSessionWritable: () => this.assertSessionWritable(),
      emit: (event) => this.events.emitAgent(event)
    });
    const sessionActions = new PiRuntimeSessionActions({
      sessionBindings: this.sessionBindings,
      sessionTransitions: this.sessionTransitions,
      sessionCatalog: this.sessionCatalog,
      configurationReload: this.configurationReload,
      projections: this.projections,
      assertWritable: () => this.assertSessionWritable(),
      cancelInteractiveRequests: () => this.uiBridge.cancelAll("session-transition"),
      dropStream: () => this.streamBatcher.drop(),
      getSnapshot: () => this.getSnapshot(),
      emit: (event) => this.events.emitAgent(event)
    });
    this.conversationActions = new PiRuntimeConversationActions({
      sessionBindings: this.sessionBindings,
      sessionLifecycle: this.sessionLifecycle,
      sessionActions,
      persistProjection: () => this.sessionCatalog.upsertCurrent("session-updated"),
      assertWritable: () => this.assertSessionWritable()
    });
    this.promptActions = new PiRuntimePromptActions({
      sessionBindings: this.sessionBindings,
      sessionCatalog: this.sessionCatalog,
      configurationReload: this.configurationReload,
      promptAttachments: this.promptAttachments,
      assertWritable: () => this.assertSessionWritable(),
      generateSemanticTitle: () => this.conversationActions.scheduleSemanticTitle()
    });
    this.runtimeCredentialUnsubscribe = this.runtimeCredentialOverrides.subscribe(
      async (provider, apiKey) => {
        const services = this.sessionBindings.services;
        if (!services) return;
        await services.modelRuntime.setRuntimeApiKey(provider, apiKey);
      }
    );
    this.configurationRuntimeUnsubscribe = this.workspaceServices?.configurationService?.registerRuntime(
      this.workspaceServices.cwd,
      this
    );
  }
  getSdkVersion(): string { return VERSION; }
  getExtensionUiCapabilities(): RuntimeCapabilities["extensionUi"] { return this.projections.getCapabilities(); }
  subscribe(listener: (event: AgentEvent) => void): () => void { return this.events.subscribeAgent(listener); }
  subscribeOperationActivity(listener: (activity: RuntimeOperationActivity) => void): () => void { return this.events.subscribeActivity(listener); }
  subscribeToolExecution(listener: (execution: ToolExecutionView) => void): () => void { return this.events.subscribeToolExecution(listener); }
  async initialize(options: RuntimeInitializeOptions, observeStage?: RuntimeInitializationObserver): Promise<SessionSnapshot> {
    this.conversationActions.cancelSemanticTitle();
    const snapshot = await this.sessionLifecycle.initialize(options, observeStage);
    if (options.sessionPath) this.conversationActions.scheduleSemanticTitle();
    return snapshot;
  }
  async dispose(): Promise<void> {
    this.conversationActions.cancelSemanticTitle();
    this.streamBatcher.drop();
    this.uiBridge.cancelAll("runtime-dispose");
    await this.subagents.dispose();
    await this.configurationReload.dispose();
    await this.sessionBindings.settleAndDispose();
    await this.sessionCatalog.dispose();
    this.runtimeCredentialUnsubscribe?.();
    this.runtimeCredentialUnsubscribe = undefined;
    this.configurationRuntimeUnsubscribe?.();
    this.configurationRuntimeUnsubscribe = undefined;
    this.uiBridge.dispose();
    if (this.ownsRuntimeCredentialOverrides) await this.runtimeCredentialOverrides.clear();
    this.events.clear();
  }
  setWorkspacePolicy(trust: WorkspaceTrust, approvalMode: ApprovalMode): TaskToolMode {
    const mode = this.toolSafety.setWorkspacePolicy(trust, approvalMode);
    this.workspaceServices?.setProjectTrusted(trust === "trusted");
    return mode;
  }
  getTaskToolMode(): TaskToolMode { return this.toolSafety.getTaskToolMode(); }
  setTaskToolMode(mode: TaskToolMode): TaskToolMode { return this.toolSafety.setTaskToolMode(mode); }
  async requestConfigurationReload(revision: string): Promise<PiConfigurationReloadState> {
    return this.configurationReload.request(revision);
  }
  async requestModelCatalogReload(): Promise<PiConfigurationReloadState> { return this.configurationReload.requestModelCatalog(); }
  listSubagents(): NativeSubagentView[] { return this.subagents.list(); }
  getSubagentStatus(id: string): NativeSubagentView { return this.subagents.status(id); }
  waitForSubagents(
    ids: readonly string[],
    mode: "first" | "all",
    timeoutMs: number
  ): Promise<NativeSubagentWaitResult> { return this.subagents.wait(ids, mode, timeoutMs); }
  steerSubagent(id: string, text: string): Promise<NativeSubagentView> {
    return this.subagents.steer(id, text);
  }
  stopSubagent(id: string): Promise<NativeSubagentView> { return this.subagents.stop(id); }
  resumeSubagent(id: string, mode?: NativeSubagentMode): Promise<NativeSubagentView> {
    return this.subagents.resume(id, mode);
  }

  querySessionCatalog(query: SessionCatalogQuery): Promise<SessionCatalogPage> { return this.sessionCatalog.query(query); }
  getSessionCatalogStatus(): SessionCatalogStatus { return this.sessionCatalog.status(); }
  getSessionTree(): SessionTreeProjection { return this.projections.getTree(); }
  getMessagePage(options: { direction: "older" | "newer"; cursor?: string; limit?: number }): ConversationPage { return this.projections.getMessagePage(options); }
  getUserMessageIndex(options: { offset?: number; limit?: number }) { return this.projections.getUserMessageIndex(options); }
  searchMessages(query: string) { return this.projections.searchMessages(query); }
  locateMessage(id: string) { return this.projections.locateMessage(id); }
  readAsset(options: {
    assetId: string;
    sessionGeneration: number;
    offset: number;
    length?: number;
  }): AssetReadResult { return this.projections.readAsset(options); }

  async createSession(creationId: string): Promise<SessionSnapshot> {
    return this.conversationActions.create(creationId);
  }

  async openSession(path: string, cwdOverride?: string): Promise<SessionSnapshot> {
    return this.conversationActions.open(path, cwdOverride);
  }
  async importSession(path: string): Promise<SessionSnapshot> {
    return this.conversationActions.import(path);
  }

  async forkSession(entryId: string, position: "before" | "at" = "at"): Promise<SessionSnapshot> {
    return this.conversationActions.fork(entryId, position);
  }

  async forkSessionFrom(sourcePath: string, entryId: string): Promise<SessionSnapshot> {
    return this.conversationActions.forkFrom(sourcePath, entryId);
  }

  async rollback(entryId: string, summarize = false): Promise<void> {
    await this.conversationActions.rollback(entryId, summarize);
  }

  async compact(instructions?: string): Promise<void> {
    await this.conversationActions.compact(instructions);
  }
  async setSessionName(name?: string): Promise<void> {
    await this.conversationActions.setName(name);
  }
  async regenerateSessionTitle(): Promise<void> {
    await this.conversationActions.regenerateTitle();
  }
  async setInteractionMode(mode: SessionInteractionMode): Promise<void> {
    await this.conversationActions.setInteractionMode(mode);
  }

  async implementPlan(planId: string, lineage: PlanImplementationRequestLineage): Promise<void> {
    await this.conversationActions.implementPlan(planId, lineage);
  }

  async preparePromptAttachments(submissionId: string, refs: readonly PromptAttachmentRef[]): Promise<PreparedPromptAttachmentSet | undefined> {
    return this.promptAttachments.claim(submissionId, refs);
  }

  async submitPrompt(text: string, attachments?: PreparedPromptAttachmentSet, signal?: AbortSignal): Promise<void> {
    await this.promptActions.submit(text, attachments, signal);
  }

  async steer(text: string, attachments?: PreparedPromptAttachmentSet): Promise<void> {
    await this.promptActions.steer(text, attachments);
  }

  async followUp(text: string, attachments?: PreparedPromptAttachmentSet): Promise<void> {
    await this.promptActions.followUp(text, attachments);
  }

  clearQueue() { return this.promptActions.clearQueue(); }

  async abort(): Promise<void> {
    this.conversationActions.cancelSemanticTitle();
    this.uiBridge.cancelAll("abort");
    this.projections.requestToolCancellation();
    this.promptAttachments.abort();
    await this.sessionBindings.requireSession().abort();
  }

  async selectModel(provider: string, id: string): Promise<SessionModelCatalogResult> {
    this.conversationActions.cancelSemanticTitle();
    await this.assertSessionWritable();
    await this.configurationReload.apply();
    const session = this.sessionBindings.requireSession();
    await selectSessionModel(session, provider, id);
    this.configurationReload.markModelSelected();
    return projectSessionModelCatalogResult(session);
  }

  async setRuntimeApiKey(provider: string, apiKey: string): Promise<SessionModelCatalogResult> {
    const session = this.sessionBindings.requireSession();
    await this.runtimeCredentialOverrides.set(provider, apiKey);
    return projectSessionModelCatalogResult(session);
  }

  async setThinkingLevel(level: string): Promise<SessionControlResult> {
    await this.assertSessionWritable();
    const session = this.sessionBindings.requireSession();
    setSessionThinkingLevel(session, level);
    return { sessionId: session.sessionId, controls: projectSessionControls(session) };
  }

  async reloadResources(): Promise<SessionResourceCatalogResult> {
    return this.sessionLifecycle.reloadResources();
  }

  async invokeCommand(command: string): Promise<void> {
    await this.promptActions.invokeCommand(command);
  }

  getCommands(): SlashCommandCatalogResult { return this.projections.getCommands(); }
  getExtensionCatalog(): ExtensionCatalogResult { return this.projections.getCatalog(); }
  getWorkspaceChanges() {
    return this.projections.getWorkspaceChanges(this.sessionBindings.requireSession());
  }

  resolveExtensionUi(requestId: string, value?: string | boolean, cancelled?: boolean): boolean { return this.uiBridge.resolve(requestId, value, cancelled); }
  resolveApproval(
    requestId: string,
    toolCallId: string,
    decision: ApprovalResponseDecision
  ): ApprovalResolution {
    return this.toolSafety.resolveApproval(this.uiBridge, requestId, toolCallId, decision);
  }
  hasPendingSubagentApproval(requestId: string, toolCallId: string): boolean {
    return this.uiBridge.hasPendingSubagentApproval(requestId, toolCallId);
  }
  cancelInteractiveRequests(reason: ExtensionUiCancellationReason): string[] { return this.uiBridge.cancelAll(reason); }

  async collectDiagnostics(): Promise<RuntimeDiagnostics> {
    return collectPiRuntimeDiagnostics(this.sessionBindings, this.projections);
  }

  async runDoctor(): Promise<DoctorReport> {
    return runPiRuntimeDoctor(
      this.sessionBindings,
      this.getSessionCatalogStatus(),
      (event) => this.events.emitAgent(event)
    );
  }

  getSnapshot(): SessionSnapshot {
    return {
      ...this.projections.getSnapshot(
        this.sessionBindings.requireSession(),
        this.sessionBindings.services,
        this.sessionBindings.extensions
      ),
      ...this.sessionBindings.interactionState
    };
  }
  getModels(): ModelSummary[] { return projectSessionModels(this.sessionBindings.requireSession()); }
  getResources(): ResourceCatalogProjection {
    return projectSessionResourceCatalog(this.sessionBindings.services, this.sessionBindings.extensions);
  }
  getIdentity(): RuntimeIdentity {
    return getPiRuntimeIdentity(this.sessionBindings);
  }
  flushStream(): void { this.streamBatcher.flush(); }
  private assertSessionWritable(): Promise<void> {
    return this.externalSessionChangeGuard.assertUnchanged(this.sessionBindings.session);
  }
}
