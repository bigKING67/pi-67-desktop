import { stat } from "node:fs/promises";
import {
  AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionServices,
  createAgentSession,
  getAgentDir,
  SessionManager,
  SettingsManager,
  VERSION,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type LoadExtensionsResult
} from "@earendil-works/pi-coding-agent";
import type {
  ApprovalMode,
  DoctorReport,
  SessionSnapshot,
  SessionSummary,
  WorkspaceTrust
} from "@pi67/domain";
import type { AgentEvent, TransferImage } from "@pi67/protocol";
import type { AgentRuntime, RuntimeInitializeOptions } from "./agent-runtime.js";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { convertTransferImages, normalizeStreamDelta } from "./message-normalizer.js";
import { createDoctorReport } from "./runtime-doctor.js";
import { createDesktopSafetyExtension, type SafetyPolicyState } from "./safety-extension.js";
import { listAgentSessions } from "./session-discovery.js";
import { discardStagedSessionImport, resolveManagedSessionPath, stageSessionImport } from "./session-import.js";
import { projectSessionSnapshot } from "./session-snapshot.js";
import { StreamBatcher } from "./stream-batcher.js";

export class PiSdkRuntime implements AgentRuntime {
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private sessionRuntime: AgentSessionRuntime | undefined;
  private sessionUnsubscribe: (() => void) | undefined;
  private services: AgentSessionServices | undefined;
  private settingsManager: SettingsManager | undefined;
  private extensionsResult: LoadExtensionsResult | undefined;
  private uiBridge = new DesktopExtensionUiBridge((event) => this.emit(event));
  private readonly runtimeApiKeys = new Map<string, string>();
  private safety: SafetyPolicyState = { cwd: process.cwd(), trust: "unknown", approvalMode: "guided" };
  private agentDir = getAgentDir();
  private sessionTransition: Promise<unknown> | undefined;
  private sequence = 0;
  private lastSessionMtime = 0;
  private readonly streamBatcher = new StreamBatcher((events) => {
    this.emit({ type: "turn.streamBatch", payload: { events } });
  });

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(options: RuntimeInitializeOptions): Promise<SessionSnapshot> {
    return this.runSessionTransition(async () => {
      this.agentDir = options.agentDir ?? getAgentDir();
      this.safety = { cwd: options.cwd, trust: options.trust, approvalMode: options.approvalMode };
      const sessionPath = options.sessionPath
        ? await resolveManagedSessionPath(options.sessionPath, options.cwd, this.agentDir)
        : undefined;
      const sessionManager = sessionPath ? SessionManager.open(sessionPath, undefined, options.cwd) : undefined;
      await this.disposeSessionRuntime();
      await this.createInitialSessionRuntime(options.cwd, sessionManager);
      return this.getSnapshot();
    });
  }

  async dispose(): Promise<void> {
    this.streamBatcher.dispose();
    await this.sessionTransition?.catch(() => undefined);
    await this.disposeSessionRuntime();
    this.uiBridge.dispose();
    this.runtimeApiKeys.clear();
    this.listeners.clear();
  }

  setWorkspacePolicy(trust: WorkspaceTrust, approvalMode: ApprovalMode): void {
    this.safety = { ...this.safety, trust, approvalMode };
  }

  async listSessions(all = false): Promise<SessionSummary[]> {
    const configuredSessionDir = this.settingsManager?.getSessionDir();
    const sessions = all
      ? configuredSessionDir
        ? await SessionManager.listAll(configuredSessionDir)
        : await listAgentSessions(this.agentDir)
      : await SessionManager.list(this.safety.cwd, configuredSessionDir ?? this.requireSession().sessionManager.getSessionDir());
    return sessions.map((session) => ({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name ?? (session.firstMessage.trim().slice(0, 80) || "Untitled session"),
      modifiedAt: session.modified.getTime(),
      messageCount: session.messageCount,
      ...(session.parentSessionPath ? { parentSessionPath: session.parentSessionPath } : {})
    }));
  }

  async createSession(cwd: string): Promise<SessionSnapshot> {
    return this.runSessionTransition(async () => {
      this.safety = { ...this.safety, cwd };
      const result = await this.requireSessionRuntime().newSession();
      if (result.cancelled) throw new Error("A Pi extension cancelled the new session.");
      return this.getSnapshot();
    });
  }

  async openSession(path: string, cwdOverride?: string): Promise<SessionSnapshot> {
    return this.runSessionTransition(async () => {
      await this.assertNoExternalSessionChange();
      const managedPath = await resolveManagedSessionPath(path, cwdOverride ?? this.safety.cwd, this.agentDir);
      const result = await this.requireSessionRuntime().switchSession(
        managedPath,
        cwdOverride ? { cwdOverride } : undefined
      );
      if (result.cancelled) throw new Error("A Pi extension cancelled the session switch.");
      this.safety = { ...this.safety, cwd: this.requireSession().sessionManager.getCwd() };
      return this.getSnapshot();
    });
  }

  async importSession(path: string): Promise<SessionSnapshot> {
    return this.runSessionTransition(async () => {
      await this.assertNoExternalSessionChange();
      const sessionDirectory = this.requireSession().sessionManager.getSessionDir();
      const staged = await stageSessionImport(path, sessionDirectory, this.safety.cwd);
      try {
        const result = await this.requireSessionRuntime().switchSession(staged.path, {
          cwdOverride: staged.sessionManager.getCwd()
        });
        if (result.cancelled) throw new Error("A Pi extension cancelled the session import.");
        this.safety = { ...this.safety, cwd: this.requireSession().sessionManager.getCwd() };
        return this.getSnapshot();
      } catch (error) {
        await discardStagedSessionImport(staged, error);
        throw error;
      }
    });
  }

  async branch(entryId: string, newFile = false): Promise<SessionSnapshot> {
    const session = this.requireSession();
    if (newFile) {
      return this.runSessionTransition(async () => {
        const result = await this.requireSessionRuntime().fork(entryId, { position: "at" });
        if (result.cancelled) throw new Error("A Pi extension cancelled the session branch.");
        return this.getSnapshot();
      });
    }
    await session.navigateTree(entryId, { summarize: false });
    return this.emitSnapshot();
  }

  async rollback(entryId: string, summarize = false): Promise<SessionSnapshot> {
    await this.requireSession().navigateTree(entryId, { summarize });
    return this.emitSnapshot();
  }

  async compact(instructions?: string): Promise<SessionSnapshot> {
    await this.requireSession().compact(instructions);
    return this.emitSnapshot();
  }

  async setSessionName(name: string): Promise<SessionSnapshot> {
    this.requireSession().setSessionName(name.trim());
    return this.emitSnapshot();
  }

  async send(text: string, images: TransferImage[] = []): Promise<void> {
    await this.assertNoExternalSessionChange();
    const session = this.requireSession();
    await session.prompt(text, {
      images: convertTransferImages(images),
      ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {})
    });
  }

  async steer(text: string, images: TransferImage[] = []): Promise<void> {
    await this.requireSession().steer(text, convertTransferImages(images));
  }

  async followUp(text: string, images: TransferImage[] = []): Promise<void> {
    await this.requireSession().followUp(text, convertTransferImages(images));
  }

  async abort(): Promise<void> {
    await this.requireSession().abort();
    this.emitSnapshot();
  }

  async selectModel(provider: string, id: string): Promise<SessionSnapshot> {
    const session = this.requireSession();
    const model = session.modelRuntime.getModel(provider, id);
    if (!model) throw new Error(`Unknown Pi model: ${provider}/${id}`);
    await session.setModel(model);
    return this.emitSnapshot();
  }

  async setRuntimeApiKey(provider: string, apiKey: string): Promise<SessionSnapshot> {
    const normalizedProvider = provider.trim();
    const normalizedKey = apiKey.trim();
    if (!normalizedProvider || normalizedKey.length < 8) throw new Error("Provider and API key are required.");
    try {
      await this.requireSession().modelRuntime.setRuntimeApiKey(normalizedProvider, normalizedKey, {
        allowNetwork: false
      });
      this.runtimeApiKeys.set(normalizedProvider, normalizedKey);
    } catch {
      // Provider errors are intentionally hidden so a credential can never be echoed into UI events.
      throw new Error("Unable to configure the runtime API key for this provider.");
    }
    return this.emitSnapshot();
  }

  async setThinkingLevel(level: string): Promise<SessionSnapshot> {
    const session = this.requireSession();
    const selectedLevel = session.getAvailableThinkingLevels().find((candidate) => candidate === level);
    if (!selectedLevel) {
      throw new Error(`Unsupported thinking level: ${level}`);
    }
    session.setThinkingLevel(selectedLevel);
    return this.emitSnapshot();
  }

  async reloadResources(): Promise<SessionSnapshot> {
    return this.runSessionTransition(async () => {
      await this.requireSession().reload();
      this.extensionsResult = this.services?.resourceLoader.getExtensions();
      this.emit({ type: "resource.changed", payload: { reason: "reload" } });
      return this.emitSnapshot();
    });
  }

  async invokeCommand(command: string): Promise<void> {
    const normalized = command.startsWith("/") ? command : `/${command}`;
    const session = this.requireSession();
    await session.prompt(normalized, session.isStreaming ? { streamingBehavior: "followUp" } : {});
  }

  getCommands(): Array<{ name: string; description?: string }> {
    const commands: Array<{ name: string; description?: string }> = [];
    for (const extension of this.extensionsResult?.extensions ?? []) {
      for (const [name, command] of extension.commands) {
        commands.push({ name, ...(command.description ? { description: command.description } : {}) });
      }
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  resolveExtensionUi(requestId: string, value?: string | boolean, cancelled?: boolean): boolean {
    return this.uiBridge.resolve(requestId, value, cancelled);
  }

  async collectDiagnostics(): Promise<Record<string, unknown>> {
    const session = this.sessionRuntime?.session;
    return {
      application: "Pi-67 Desktop",
      piSdkVersion: VERSION,
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      cwd: session?.sessionManager.getCwd(),
      sessionConfigured: Boolean(session),
      sessionFileConfigured: Boolean(session?.sessionFile),
      model: session?.model ? `${session.model.provider}/${session.model.id}` : undefined,
      extensionCount: this.extensionsResult?.extensions.length ?? 0,
      extensionErrors: this.extensionsResult?.errors.map((error) => ({ path: error.path, error: error.error })) ?? []
    };
  }

  async runDoctor(): Promise<DoctorReport> {
    const report = await createDoctorReport(this.settingsManager?.getShellPath());
    this.emit({ type: "doctor.completed", payload: report });
    return report;
  }

  getSnapshot(): SessionSnapshot {
    return projectSessionSnapshot(this.requireSession(), this.services, this.extensionsResult);
  }

  private async createInitialSessionRuntime(cwd: string, sessionManager?: SessionManager): Promise<void> {
    const services = await this.createSessionServices(cwd);
    const result = sessionManager
      ? await createAgentSessionFromServices({ services, sessionManager })
      : await createAgentSession({
        cwd,
        agentDir: this.agentDir,
        modelRuntime: services.modelRuntime,
        settingsManager: services.settingsManager,
        resourceLoader: services.resourceLoader
      });
    const createRuntime = this.createRuntimeFactory();
    const runtime = new AgentSessionRuntime(result.session, services, createRuntime, services.diagnostics, result.modelFallbackMessage);
    this.sessionRuntime = runtime;
    runtime.setBeforeSessionInvalidate(() => this.detachSessionBindings());
    runtime.setRebindSession((session) => this.bindSession(session));
    await this.bindSession(result.session);
  }

  private createRuntimeFactory(): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await this.createSessionServices(cwd);
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        ...(sessionStartEvent ? { sessionStartEvent } : {})
      });
      return { ...result, services, diagnostics: services.diagnostics };
    };
  }

  private async createSessionServices(cwd: string): Promise<AgentSessionServices> {
    const services = await createAgentSessionServices({
      cwd,
      agentDir: this.agentDir,
      resourceLoaderOptions: {
        extensionFactories: [createDesktopSafetyExtension(() => this.safety)]
      },
      resourceLoaderReloadOptions: {
        resolveProjectTrust: async () => this.safety.trust === "trusted"
      }
    });
    for (const [provider, apiKey] of this.runtimeApiKeys) {
      await services.modelRuntime.setRuntimeApiKey(provider, apiKey, { allowNetwork: false });
    }
    return services;
  }

  private async bindSession(session: AgentSession): Promise<void> {
    this.services = this.requireSessionRuntime().services;
    this.settingsManager = this.services.settingsManager;
    this.extensionsResult = this.services.resourceLoader.getExtensions();
    this.uiBridge.dispose();
    this.uiBridge = new DesktopExtensionUiBridge((event) => this.emit(event));
    await session.bindExtensions({
      uiContext: this.uiBridge.context,
      mode: "rpc",
      onError: (error) => {
        this.emit({
          type: "extension.compatibilityChanged",
          payload: { extensionId: error.extensionPath, status: "failed", detail: error.error }
        });
      }
    });
    this.sessionUnsubscribe = session.subscribe((event) => this.handleSessionEvent(event));
    await this.rememberSessionMtime();
  }

  private detachSessionBindings(): void {
    this.sessionUnsubscribe?.();
    this.sessionUnsubscribe = undefined;
    this.uiBridge.dispose();
  }

  private async disposeSessionRuntime(): Promise<void> {
    const runtime = this.sessionRuntime;
    if (!runtime) return;
    if (runtime.session.isStreaming) await runtime.session.abort();
    await runtime.dispose();
    this.sessionRuntime = undefined;
    this.services = undefined;
    this.settingsManager = undefined;
    this.extensionsResult = undefined;
  }

  private handleSessionEvent(event: AgentSessionEvent): void {
    if (event.type === "message_update") {
      const delta = normalizeStreamDelta(event);
      if (delta) this.streamBatcher.push(delta);
    } else {
      this.emit({ type: "session.delta", payload: { eventType: event.type, data: null } });
    }

    if (event.type === "entry_appended") void this.rememberSessionMtime();
    if (
      event.type === "message_end" ||
      event.type === "agent_end" ||
      event.type === "agent_settled" ||
      event.type === "queue_update" ||
      event.type === "thinking_level_changed" ||
      event.type === "compaction_end"
    ) {
      this.emitSnapshot();
    }
  }

  private emitSnapshot(): SessionSnapshot {
    const snapshot = this.getSnapshot();
    this.emit({ type: "session.snapshot", payload: snapshot });
    return snapshot;
  }

  private emit(event: AgentEvent): void {
    this.sequence += 1;
    this.listeners.forEach((listener) => listener(event));
  }

  private requireSession(): AgentSession {
    return this.requireSessionRuntime().session;
  }

  private requireSessionRuntime(): AgentSessionRuntime {
    if (!this.sessionRuntime) throw new Error("Pi SDK runtime is not initialized.");
    return this.sessionRuntime;
  }

  private async runSessionTransition<T>(operation: () => Promise<T>): Promise<T> {
    if (this.sessionTransition) throw new Error("Another Pi session transition is already in progress.");
    const transition = Promise.resolve().then(operation);
    this.sessionTransition = transition;
    try {
      return await transition;
    } finally {
      if (this.sessionTransition === transition) this.sessionTransition = undefined;
    }
  }

  private async rememberSessionMtime(): Promise<void> {
    const file = this.sessionRuntime?.session.sessionFile;
    if (!file) return;
    try {
      this.lastSessionMtime = (await stat(file)).mtimeMs;
    } catch {
      this.lastSessionMtime = 0;
    }
  }

  private async assertNoExternalSessionChange(): Promise<void> {
    const session = this.sessionRuntime?.session;
    const file = session?.sessionFile;
    if (!file || this.lastSessionMtime === 0) return;
    const current = (await stat(file)).mtimeMs;
    if (current !== this.lastSessionMtime && !session.isStreaming) {
      this.emit({ type: "session.externalChangeDetected", payload: { path: file } });
      throw new Error("The Pi session changed outside Desktop. Reload it before writing.");
    }
  }
}
