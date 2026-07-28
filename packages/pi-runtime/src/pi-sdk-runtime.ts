import { getAgentDir, SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import {
  type ApprovalMode, type ConversationPage, type DoctorReport, type ExtensionCatalogResult,
  type ExtensionUiCancellationReason, type ModelSummary, type ResourceSummary,
  type RuntimeCapabilities, type RuntimeIdentity, type RuntimeOperationActivity,
  type SessionCatalogPage, type SessionCatalogQuery, type SessionCatalogStatus,
  type SessionControlResult, type SessionModelCatalogResult, type SessionResourceCatalogResult,
  type SessionSnapshot, type SessionTreeProjection,
  type WorkspaceTrust
} from "@pi67/domain";
import type {
  AgentEvent, AssetReadResult, CommandDescriptor, PiConfigurationReloadState,
  RuntimeDiagnostics, StreamDelta,
  TransferImage
} from "@pi67/protocol";
import type { AgentRuntime, RuntimeInitializeOptions } from "./agent-runtime.js";
import { bindSessionExtensionUi, createSessionExtensionUiBridge } from "./extension-ui-lifecycle.js";
import { conversationChangedEvent, sessionMetaChangedEvent, usageChangedEvent } from "./incremental-events.js";
import { convertTransferImages } from "./message-normalizer.js";
import { selectSessionModel, setSessionThinkingLevel } from "./model-control.js";
import { createDoctorReport } from "./runtime-doctor.js";
import { createRuntimeCredentialOverrideStore, type RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import { projectRuntimeDiagnostics, projectRuntimeIdentity } from "./runtime-metadata.js";
import { PiRuntimeConfigurationReload } from "./pi-runtime-configuration-reload.js";
import { RuntimeProjectionController } from "./runtime-projection-controller.js";
import { createRuntimeSessionCatalog, type RuntimeSessionCatalogTarget } from "./runtime-session-catalog.js";
import { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import { clearSessionQueue } from "./session-queue.js";
import type { SafetyPolicyState } from "./safety-extension.js";
import { SessionExternalChangeGuard } from "./session-external-change-guard.js";
import { discardStagedSessionImport, resolveManagedSessionPath, stageSessionImport } from "./session-import.js";
import {
  projectSessionControls, projectSessionModelCatalog, projectSessionModels, projectSessionResources
} from "./session-snapshot.js";
import { StreamBatcher } from "./stream-batcher.js";
import type { PiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";

export interface PiSdkRuntimeOptions {
  workspaceServices?: PiWorkspaceRuntimeServices;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
}

export class PiSdkRuntime implements AgentRuntime {
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly activityListeners = new Set<(activity: RuntimeOperationActivity) => void>();
  private readonly runtimeCredentialOverrides: RuntimeCredentialOverrideStore;
  private readonly ownsRuntimeCredentialOverrides: boolean;
  private readonly workspaceServices: PiWorkspaceRuntimeServices | undefined;
  private runtimeCredentialUnsubscribe: (() => void) | undefined;
  private configurationRuntimeUnsubscribe: (() => void) | undefined;
  private readonly configurationReload: PiRuntimeConfigurationReload;
  private safety: SafetyPolicyState = { cwd: process.cwd(), trust: "unknown", approvalMode: "guided" };
  private agentDir = getAgentDir();
  private readonly externalSessionChangeGuard = new SessionExternalChangeGuard();
  private readonly streamBatcher: StreamBatcher<StreamDelta>;
  private readonly projections: RuntimeProjectionController;
  private readonly sessionBindings: RuntimeSessionBindings;
  private readonly sessionCatalog: ReturnType<typeof createRuntimeSessionCatalog>;
  private uiBridge: ReturnType<typeof createSessionExtensionUiBridge>;

  constructor(options: PiSdkRuntimeOptions = {}) {
    this.workspaceServices = options.workspaceServices;
    this.ownsRuntimeCredentialOverrides = options.runtimeCredentialOverrides === undefined;
    this.runtimeCredentialOverrides = options.runtimeCredentialOverrides
      ?? createRuntimeCredentialOverrideStore();
    this.uiBridge = createSessionExtensionUiBridge(
      (event) => this.emit(event),
      () => this.sessionBindings?.session?.sessionId
    );
    this.streamBatcher = new StreamBatcher<StreamDelta>((events) => {
      this.emit({ type: "turn.streamBatch", payload: { events } });
    });
    this.projections = new RuntimeProjectionController({
      getSession: () => this.sessionBindings.requireSession(),
      getSessionGeneration: () => this.sessionBindings.sessionGeneration,
      emit: (event) => this.emit(event),
      emitActivity: (activity) => this.emitOperationActivity(activity),
      pushStream: (delta) => this.streamBatcher.push(delta),
      flushStream: () => this.streamBatcher.flush()
    });
    this.sessionBindings = new RuntimeSessionBindings({
      cancelInteractiveRequests: (reason) => { this.uiBridge.cancelAll(reason); },
      emit: (event) => this.emit(event),
      externalChangeGuard: this.externalSessionChangeGuard,
      getAgentDir: () => this.agentDir,
      getRuntimeCredentialOverrides: () => this.runtimeCredentialOverrides,
      getSafety: () => this.safety,
      getWorkspaceServices: () => this.workspaceServices,
      projections: this.projections,
      rebindExtensionUi: async (session) => {
        this.uiBridge.dispose();
        this.uiBridge = createSessionExtensionUiBridge(
          (event) => this.emit(event),
          () => this.sessionBindings.session?.sessionId
        );
        await bindSessionExtensionUi(session, this.uiBridge, (event) => this.emit(event));
      },
      requestApproval: (request, options) => this.uiBridge.requestApproval(request, options),
      setSessionCwd: (cwd) => { this.safety = { ...this.safety, cwd }; }
    });
    this.configurationReload = new PiRuntimeConfigurationReload({
      getSession: () => this.sessionBindings.session,
      emit: (event) => this.emit(event)
    });
    const sessionCatalogTarget: RuntimeSessionCatalogTarget = {
      emit: (event) => this.emit(event),
      getAgentDir: () => this.agentDir,
      getConfiguredSessionDir: () => this.sessionBindings.settingsManager?.getSessionDir(),
      getWorkspaceCwd: () => this.safety.cwd,
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
    this.runtimeCredentialUnsubscribe = this.runtimeCredentialOverrides.subscribe(
      async (provider, apiKey) => {
        const services = this.sessionBindings.services;
        if (!services) return;
        await services.modelRuntime.setRuntimeApiKey(provider, apiKey, { allowNetwork: false });
      }
    );
    this.configurationRuntimeUnsubscribe = this.workspaceServices?.configurationService?.registerRuntime(
      this.workspaceServices.cwd,
      this
    );
  }

  getSdkVersion(): string { return VERSION; }
  getExtensionUiCapabilities(): RuntimeCapabilities["extensionUi"] { return this.projections.getCapabilities(); }
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  subscribeOperationActivity(listener: (activity: RuntimeOperationActivity) => void): () => void {
    this.activityListeners.add(listener); return () => this.activityListeners.delete(listener);
  }

  async initialize(options: RuntimeInitializeOptions): Promise<SessionSnapshot> {
    return this.sessionBindings.runTransition(async () => {
      this.uiBridge.cancelAll("runtime-dispose");
      const nextAgentDir = options.agentDir ?? getAgentDir();
      this.workspaceServices?.assertCompatible(options.cwd, nextAgentDir);
      const sessionPath = options.sessionPath
        ? await resolveManagedSessionPath(options.sessionPath, options.cwd, nextAgentDir)
        : undefined;
      const sessionManager = sessionPath ? SessionManager.open(sessionPath, undefined, options.cwd) : undefined;

      // Keep the old policy visible through its shutdown hooks, then commit the
      // target workspace policy before target services or extensions are loaded.
      await this.sessionBindings.disposeRuntime();
      this.agentDir = nextAgentDir;
      this.safety = { cwd: options.cwd, trust: options.trust, approvalMode: options.approvalMode };
      this.workspaceServices?.setProjectTrusted(options.trust === "trusted");
      await this.sessionBindings.createInitial(options.cwd, sessionManager);
      await this.configurationReload.apply();
      await this.sessionCatalog.upsertCurrent("session-updated");
      return this.getSnapshot();
    });
  }

  async dispose(): Promise<void> {
    this.streamBatcher.drop();
    this.uiBridge.cancelAll("runtime-dispose");
    await this.sessionBindings.settleAndDispose();
    await this.sessionCatalog.dispose();
    this.runtimeCredentialUnsubscribe?.();
    this.runtimeCredentialUnsubscribe = undefined;
    this.configurationRuntimeUnsubscribe?.();
    this.configurationRuntimeUnsubscribe = undefined;
    this.uiBridge.dispose();
    if (this.ownsRuntimeCredentialOverrides) await this.runtimeCredentialOverrides.clear();
    this.listeners.clear();
    this.activityListeners.clear();
  }

  setWorkspacePolicy(trust: WorkspaceTrust, approvalMode: ApprovalMode): void {
    this.safety = { ...this.safety, trust, approvalMode };
    this.workspaceServices?.setProjectTrusted(trust === "trusted");
  }

  async requestConfigurationReload(revision: string): Promise<PiConfigurationReloadState> {
    return this.configurationReload.request(revision);
  }

  querySessionCatalog(query: SessionCatalogQuery): Promise<SessionCatalogPage> { return this.sessionCatalog.query(query); }
  getSessionCatalogStatus(): SessionCatalogStatus { return this.sessionCatalog.status(); }
  getSessionTree(): SessionTreeProjection { return this.projections.getTree(); }
  getMessagePage(options: { direction: "older" | "newer"; cursor?: string; limit?: number }): ConversationPage { return this.projections.getMessagePage(options); }
  readAsset(options: {
    assetId: string;
    sessionGeneration: number;
    offset: number;
    length?: number;
  }): AssetReadResult { return this.projections.readAsset(options); }

  async createSession(): Promise<SessionSnapshot> {
    return this.sessionBindings.runTransition(async () => {
      this.uiBridge.cancelAll("session-transition");
      this.streamBatcher.drop();
      const result = await this.sessionBindings.requireRuntime().newSession();
      if (result.cancelled) throw new Error("A Pi extension cancelled the new session.");
      await this.sessionCatalog.upsertCurrent("session-created");
      await this.configurationReload.apply();
      return this.getSnapshot();
    });
  }

  async openSession(path: string, cwdOverride?: string): Promise<SessionSnapshot> {
    return this.sessionBindings.runTransition(async () => {
      this.uiBridge.cancelAll("session-transition");
      this.streamBatcher.drop();
      await this.assertSessionWritable();
      const managedPath = await resolveManagedSessionPath(path, cwdOverride ?? this.safety.cwd, this.agentDir);
      const result = await this.sessionBindings.requireRuntime().switchSession(
        managedPath,
        cwdOverride ? { cwdOverride } : undefined
      );
      if (result.cancelled) throw new Error("A Pi extension cancelled the session switch.");
      await this.sessionCatalog.upsertCurrent("session-updated");
      await this.configurationReload.apply();
      return this.getSnapshot();
    });
  }

  async importSession(path: string): Promise<SessionSnapshot> {
    return this.sessionBindings.runTransition(async () => {
      this.uiBridge.cancelAll("session-transition");
      this.streamBatcher.drop();
      await this.assertSessionWritable();
      const sessionDirectory = this.sessionBindings.requireSession().sessionManager.getSessionDir();
      const staged = await stageSessionImport(path, sessionDirectory, this.safety.cwd);
      let switched = false;
      try {
        const result = await this.sessionBindings.requireRuntime().switchSession(staged.path, {
          cwdOverride: staged.sessionManager.getCwd()
        });
        if (result.cancelled) throw new Error("A Pi extension cancelled the session import.");
        switched = true;
        await this.sessionCatalog.upsertCurrent("session-imported");
        await this.configurationReload.apply();
        return this.getSnapshot();
      } catch (error) {
        if (!switched) await discardStagedSessionImport(staged, error);
        throw error;
      }
    });
  }

  async forkSession(entryId: string): Promise<SessionSnapshot> {
    await this.assertSessionWritable();
    return this.sessionBindings.runTransition(async () => {
      this.uiBridge.cancelAll("session-transition");
      this.streamBatcher.drop();
      const result = await this.sessionBindings.requireRuntime().fork(entryId, { position: "at" });
      if (result.cancelled) throw new Error("A Pi extension cancelled the session fork.");
      await this.sessionCatalog.upsertCurrent("session-created");
      await this.configurationReload.apply();
      return this.getSnapshot();
    });
  }

  async rollback(entryId: string, summarize = false): Promise<void> {
    await this.assertSessionWritable();
    const session = this.sessionBindings.requireSession();
    await session.navigateTree(entryId, { summarize });
    this.emit(conversationChangedEvent(session, "rolled-back"));
    this.emit({ type: "tree.changed", payload: { reason: "rollback" } });
    this.emit(usageChangedEvent(this.projections.getStats(session)));
  }

  async compact(instructions?: string): Promise<void> {
    await this.assertSessionWritable();
    await this.configurationReload.assertReady();
    try {
      await this.sessionBindings.requireSession().compact(instructions);
    } finally {
      await this.configurationReload.apply();
    }
  }
  async setSessionName(name: string): Promise<void> {
    await this.assertSessionWritable();
    const session = this.sessionBindings.requireSession();
    session.setSessionName(name.trim());
    await this.sessionCatalog.upsertCurrent("session-updated");
    this.emit(sessionMetaChangedEvent(session));
  }

  async submitPrompt(text: string, images: TransferImage[] = []): Promise<void> {
    await this.assertSessionWritable();
    await this.configurationReload.assertReady();
    const session = this.sessionBindings.requireSession();
    try {
      await session.prompt(text, {
        images: convertTransferImages(images),
        ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {})
      });
    } finally {
      await this.sessionCatalog.upsertCurrent("session-updated");
      await this.configurationReload.apply();
    }
  }

  async steer(text: string, images: TransferImage[] = []): Promise<void> {
    await this.assertSessionWritable();
    await this.configurationReload.assertReady();
    await this.sessionBindings.requireSession().steer(text, convertTransferImages(images));
  }

  async followUp(text: string, images: TransferImage[] = []): Promise<void> {
    await this.assertSessionWritable();
    await this.configurationReload.assertReady();
    await this.sessionBindings.requireSession().followUp(text, convertTransferImages(images));
  }

  clearQueue() { return clearSessionQueue(this.sessionBindings.requireSession()); }

  async abort(): Promise<void> {
    this.uiBridge.cancelAll("abort");
    await this.sessionBindings.requireSession().abort();
  }

  async selectModel(provider: string, id: string): Promise<SessionControlResult> {
    await this.assertSessionWritable();
    await this.configurationReload.apply();
    const session = this.sessionBindings.requireSession();
    await selectSessionModel(session, provider, id);
    this.configurationReload.markModelSelected();
    return { sessionId: session.sessionId, controls: projectSessionControls(session) };
  }

  async setRuntimeApiKey(provider: string, apiKey: string): Promise<SessionModelCatalogResult> {
    const session = this.sessionBindings.requireSession();
    await this.runtimeCredentialOverrides.set(provider, apiKey);
    return {
      sessionId: session.sessionId,
      controls: projectSessionControls(session),
      modelCatalog: projectSessionModelCatalog(session)
    };
  }

  async setThinkingLevel(level: string): Promise<SessionControlResult> {
    await this.assertSessionWritable();
    const session = this.sessionBindings.requireSession();
    setSessionThinkingLevel(session, level);
    return { sessionId: session.sessionId, controls: projectSessionControls(session) };
  }

  async reloadResources(): Promise<SessionResourceCatalogResult> {
    return this.sessionBindings.runTransition(async () => {
      await this.assertSessionWritable();
      this.uiBridge.cancelAll("resource-reload");
      this.projections.resetExtensionAdapters();
      const generationBeforeReload = this.sessionBindings.sessionGeneration;
      await this.sessionBindings.requireSession().reload();
      if (this.sessionBindings.sessionGeneration === generationBeforeReload) {
        const extensions = this.sessionBindings.refreshExtensions();
        await this.projections.refreshExtensionAdapters(this.sessionBindings.requireSession(), extensions);
        this.emit({ type: "extension.catalog.changed", payload: this.getExtensionCatalog() });
      }
      this.emit({ type: "resource.changed", payload: { reason: "reload" } });
      const session = this.sessionBindings.requireSession();
      return {
        sessionId: session.sessionId,
        controls: projectSessionControls(session),
        modelCatalog: projectSessionModelCatalog(session),
        resources: projectSessionResources(
          this.sessionBindings.services,
          this.sessionBindings.extensions
        )
      };
    });
  }

  async invokeCommand(command: string): Promise<void> {
    await this.assertSessionWritable();
    await this.configurationReload.assertReady();
    const normalized = command.startsWith("/") ? command : `/${command}`;
    const session = this.sessionBindings.requireSession();
    try {
      await session.prompt(normalized, session.isStreaming ? { streamingBehavior: "followUp" } : {});
    } finally {
      await this.sessionCatalog.upsertCurrent("session-updated");
      await this.configurationReload.apply();
    }
  }

  getCommands(): CommandDescriptor[] { return this.projections.getCommands(); }

  getExtensionCatalog(): ExtensionCatalogResult { return this.projections.getCatalog(); }

  getWorkspaceChanges() {
    return this.projections.getWorkspaceChanges(this.sessionBindings.requireSession());
  }

  resolveExtensionUi(requestId: string, value?: string | boolean, cancelled?: boolean): boolean { return this.uiBridge.resolve(requestId, value, cancelled); }
  resolveApproval(requestId: string, toolCallId: string, allowed: boolean): boolean { return this.uiBridge.resolveApproval(requestId, toolCallId, allowed); }
  cancelInteractiveRequests(reason: ExtensionUiCancellationReason): string[] { return this.uiBridge.cancelAll(reason); }

  async collectDiagnostics(): Promise<RuntimeDiagnostics> {
    return projectRuntimeDiagnostics(this.sessionBindings.runtime, this.sessionBindings.extensions, VERSION);
  }

  async runDoctor(): Promise<DoctorReport> {
    const report = await createDoctorReport(
      this.sessionBindings.settingsManager?.getShellPath(),
      process.env.PI67_CAPABILITY_PROBE_DIR,
      this.getSessionCatalogStatus()
    );
    this.emit({ type: "doctor.completed", payload: report });
    return report;
  }

  getSnapshot(): SessionSnapshot {
    return this.projections.getSnapshot(
      this.sessionBindings.requireSession(),
      this.sessionBindings.services,
      this.sessionBindings.extensions
    );
  }

  getModels(): ModelSummary[] {
    return projectSessionModels(this.sessionBindings.requireSession());
  }

  getResources(): ResourceSummary[] {
    return projectSessionResources(
      this.sessionBindings.services,
      this.sessionBindings.extensions
    );
  }

  getIdentity(): RuntimeIdentity {
    return projectRuntimeIdentity(this.sessionBindings.runtime, this.sessionBindings.sessionGeneration);
  }

  flushStream(): void {
    this.streamBatcher.flush();
  }

  private assertSessionWritable(): Promise<void> {
    return this.externalSessionChangeGuard.assertUnchanged(this.sessionBindings.session);
  }

  private emit(event: AgentEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private emitOperationActivity(activity: RuntimeOperationActivity): void {
    this.activityListeners.forEach((listener) => listener(activity));
  }
}
