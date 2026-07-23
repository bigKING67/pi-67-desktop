import { stat } from "node:fs/promises";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  VERSION,
  type AgentSession,
  type AgentSessionEvent,
  type LoadExtensionsResult
} from "@earendil-works/pi-coding-agent";
import type {
  ApprovalMode,
  DoctorReport,
  ModelSummary,
  ResourceSummary,
  SessionSnapshot,
  SessionSummary,
  SessionTreeNodeView,
  WorkspaceTrust
} from "@pi67/domain";
import type { AgentEvent, TransferImage } from "@pi67/protocol";
import type { AgentRuntime, RuntimeInitializeOptions } from "./agent-runtime.js";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { convertTransferImages, normalizeMessages, normalizeStreamDelta } from "./message-normalizer.js";
import { createDoctorReport } from "./runtime-doctor.js";
import { createDesktopSafetyExtension, type SafetyPolicyState } from "./safety-extension.js";
import { listAgentSessions } from "./session-discovery.js";
import { discardStagedSessionImport, resolveManagedSessionPath, stageSessionImport } from "./session-import.js";
import { StreamBatcher } from "./stream-batcher.js";

export class PiSdkRuntime implements AgentRuntime {
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private session: AgentSession | undefined;
  private sessionUnsubscribe: (() => void) | undefined;
  private resourceLoader: DefaultResourceLoader | undefined;
  private settingsManager: SettingsManager | undefined;
  private extensionsResult: LoadExtensionsResult | undefined;
  private uiBridge = new DesktopExtensionUiBridge((event) => this.emit(event));
  private safety: SafetyPolicyState = { cwd: process.cwd(), trust: "unknown", approvalMode: "guided" };
  private agentDir = getAgentDir();
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
    this.agentDir = options.agentDir ?? getAgentDir();
    this.safety = { cwd: options.cwd, trust: options.trust, approvalMode: options.approvalMode };
    const sessionPath = options.sessionPath
      ? await resolveManagedSessionPath(options.sessionPath, options.cwd, this.agentDir)
      : undefined;
    const sessionManager = sessionPath ? SessionManager.open(sessionPath, undefined, options.cwd) : undefined;
    await this.replaceSession(options.cwd, sessionManager);
    return this.getSnapshot();
  }

  async dispose(): Promise<void> {
    this.streamBatcher.dispose();
    this.sessionUnsubscribe?.();
    this.sessionUnsubscribe = undefined;
    if (this.session?.isStreaming) await this.session.abort();
    this.session?.dispose();
    this.session = undefined;
    this.uiBridge.dispose();
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
    this.safety = { ...this.safety, cwd };
    await this.replaceSession(cwd);
    return this.getSnapshot();
  }

  async openSession(path: string, cwdOverride?: string): Promise<SessionSnapshot> {
    await this.assertNoExternalSessionChange();
    const managedPath = await resolveManagedSessionPath(path, cwdOverride ?? this.safety.cwd, this.agentDir);
    const sessionManager = SessionManager.open(managedPath, undefined, cwdOverride);
    await this.replaceSession(sessionManager.getCwd(), sessionManager);
    this.safety = { ...this.safety, cwd: this.requireSession().state ? this.requireSession().sessionManager.getCwd() : this.safety.cwd };
    return this.getSnapshot();
  }

  async importSession(path: string): Promise<SessionSnapshot> {
    await this.assertNoExternalSessionChange();
    const sessionDirectory = this.requireSession().sessionManager.getSessionDir();
    const staged = await stageSessionImport(path, sessionDirectory, this.safety.cwd);
    try {
      await this.replaceSession(staged.sessionManager.getCwd(), staged.sessionManager);
      this.safety = { ...this.safety, cwd: staged.sessionManager.getCwd() };
      return this.getSnapshot();
    } catch (error) {
      await discardStagedSessionImport(staged, error);
      throw error;
    }
  }

  async branch(entryId: string, newFile = false): Promise<SessionSnapshot> {
    const session = this.requireSession();
    if (newFile) {
      const path = session.sessionManager.createBranchedSession(entryId);
      if (!path) throw new Error("This session is not persisted and cannot create a branch file.");
      return this.openSession(path);
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
    await this.requireSession().reload();
    this.extensionsResult = this.resourceLoader?.getExtensions();
    this.emit({ type: "resource.changed", payload: { reason: "reload" } });
    return this.emitSnapshot();
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
    const session = this.session;
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
    const session = this.requireSession();
    const stats = session.getSessionStats();
    return {
      sessionId: session.sessionId,
      ...(session.sessionFile ? { sessionPath: session.sessionFile } : {}),
      ...(session.sessionName ? { sessionName: session.sessionName } : {}),
      cwd: session.sessionManager.getCwd(),
      streaming: session.isStreaming,
      messages: normalizeMessages(session.messages),
      models: this.getModels(),
      ...(session.model ? { selectedModel: { provider: session.model.provider, id: session.model.id } } : {}),
      thinkingLevel: session.thinkingLevel,
      availableThinkingLevels: session.getAvailableThinkingLevels(),
      steeringQueue: [...session.getSteeringMessages()],
      followUpQueue: [...session.getFollowUpMessages()],
      tree: this.getSessionTree(),
      resources: this.getResources(),
      stats: {
        tokens: stats.tokens.total,
        cost: stats.cost,
        ...(stats.contextUsage?.percent === null || stats.contextUsage?.percent === undefined
          ? {}
          : { contextPercent: stats.contextUsage.percent })
      }
    };
  }

  private async replaceSession(cwd: string, sessionManager?: SessionManager): Promise<void> {
    this.sessionUnsubscribe?.();
    this.sessionUnsubscribe = undefined;
    if (this.session?.isStreaming) await this.session.abort();
    this.session?.dispose();

    const settingsManager = SettingsManager.create(cwd, this.agentDir);
    const configuredSessionDir = settingsManager.getSessionDir();
    const resolvedSessionManager = sessionManager ??
      (configuredSessionDir ? SessionManager.create(cwd, configuredSessionDir) : undefined);
    this.settingsManager = settingsManager;
    this.resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: this.agentDir,
      settingsManager,
      extensionFactories: [createDesktopSafetyExtension(() => this.safety)]
    });
    await this.resourceLoader.reload({
      resolveProjectTrust: async () => this.safety.trust === "trusted"
    });
    const result = await createAgentSession({
      cwd,
      agentDir: this.agentDir,
      ...(resolvedSessionManager ? { sessionManager: resolvedSessionManager } : {}),
      settingsManager,
      resourceLoader: this.resourceLoader
    });
    this.session = result.session;
    this.extensionsResult = result.extensionsResult;
    this.uiBridge.dispose();
    this.uiBridge = new DesktopExtensionUiBridge((event) => this.emit(event));
    await this.session.bindExtensions({
      uiContext: this.uiBridge.context,
      mode: "rpc",
      onError: (error) => {
        this.emit({
          type: "extension.compatibilityChanged",
          payload: { extensionId: error.extensionPath, status: "failed", detail: error.error }
        });
      }
    });
    this.sessionUnsubscribe = this.session.subscribe((event) => this.handleSessionEvent(event));
    await this.rememberSessionMtime();
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

  private getModels(): ModelSummary[] {
    const runtime = this.requireSession().modelRuntime;
    return runtime.getModels().map((model) => ({
      provider: model.provider,
      id: model.id,
      label: model.name || model.id,
      configured: runtime.hasConfiguredAuth(model.provider),
      contextWindow: model.contextWindow,
      reasoning: model.reasoning
    }));
  }

  private getResources(): ResourceSummary[] {
    const resources: ResourceSummary[] = [];
    const loader = this.resourceLoader;
    if (!loader) return resources;
    for (const skill of loader.getSkills().skills) {
      resources.push({ kind: "skill", id: skill.name, label: skill.name, path: skill.filePath, status: "ready" });
    }
    for (const prompt of loader.getPrompts().prompts) {
      resources.push({ kind: "prompt", id: prompt.name, label: prompt.name, path: prompt.filePath, status: "ready" });
    }
    for (const extension of this.extensionsResult?.extensions ?? []) {
      resources.push({ kind: "extension", id: extension.resolvedPath, label: extension.path, path: extension.resolvedPath, status: "ready" });
    }
    for (const error of this.extensionsResult?.errors ?? []) {
      resources.push({ kind: "extension", id: error.path, label: error.path, status: "failed", detail: error.error });
    }
    for (const file of loader.getAgentsFiles().agentsFiles) {
      resources.push({ kind: "context", id: file.path, label: file.path.split(/[\\/]/).pop() ?? file.path, path: file.path, status: "ready" });
    }
    return resources;
  }

  private getSessionTree(): SessionTreeNodeView[] {
    const session = this.requireSession();
    const leafId = session.sessionManager.getLeafId();
    const normalizeNode = (node: ReturnType<SessionManager["getTree"]>[number]): SessionTreeNodeView => {
      const entry = node.entry as unknown as Record<string, unknown>;
      const id = typeof entry.id === "string" ? entry.id : "unknown";
      const parentId = typeof entry.parentId === "string" ? entry.parentId : null;
      const type = typeof entry.type === "string" ? entry.type : "entry";
      return {
        id,
        parentId,
        type,
        ...(node.label ? { label: node.label } : {}),
        preview: sessionTreePreview(entry),
        active: id === leafId,
        children: node.children.map(normalizeNode)
      };
    };
    return session.sessionManager.getTree().map(normalizeNode);
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
    if (!this.session) throw new Error("Pi SDK runtime is not initialized.");
    return this.session;
  }

  private async rememberSessionMtime(): Promise<void> {
    const file = this.session?.sessionFile;
    if (!file) return;
    try {
      this.lastSessionMtime = (await stat(file)).mtimeMs;
    } catch {
      this.lastSessionMtime = 0;
    }
  }

  private async assertNoExternalSessionChange(): Promise<void> {
    const file = this.session?.sessionFile;
    if (!file || this.lastSessionMtime === 0) return;
    const current = (await stat(file)).mtimeMs;
    if (current !== this.lastSessionMtime && !this.session?.isStreaming) {
      this.emit({ type: "session.externalChangeDetected", payload: { path: file } });
      throw new Error("The Pi session changed outside Desktop. Reload it before writing.");
    }
  }
}

function sessionTreePreview(entry: Record<string, unknown>): string {
  const message = typeof entry.message === "object" && entry.message !== null
    ? entry.message as Record<string, unknown>
    : undefined;
  const content = message?.content ?? entry.summary ?? entry.name ?? entry.type;
  if (typeof content === "string") return content.slice(0, 120);
  try {
    return JSON.stringify(content).slice(0, 120);
  } catch {
    return "Session entry";
  }
}
