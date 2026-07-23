import type {
  ApprovalMode,
  DoctorReport,
  ExtensionUiRequestView,
  RuntimeStatus,
  SessionSnapshot,
  SessionSummary,
  WorkspaceTrust
} from "@pi67/domain";
import { AgentPortClient, type AgentEvent, type TransferImage } from "@pi67/protocol";
import { create } from "zustand";

export interface UiNotice {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
}

interface AppState {
  client?: AgentPortClient;
  connected: boolean;
  runtime: RuntimeStatus;
  workspace?: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
  snapshot: SessionSnapshot | undefined;
  sessions: SessionSummary[];
  liveText: string;
  liveThinking: string;
  extensionRequests: ExtensionUiRequestView[];
  extensionStatuses: Record<string, string>;
  extensionWidgets: Record<string, string>;
  notices: UiNotice[];
  doctorReport: DoctorReport | undefined;
  doctorRunning: boolean;
  doctorError: string | undefined;
  doctorDialogOpen: boolean;
  credentialDialogOpen: boolean;
  updateDialogOpen: boolean;
  contextVisible: boolean;
  commandPaletteOpen: boolean;
  setClient: (client: AgentPortClient) => void;
  openWorkspace: () => Promise<void>;
  setTrust: (trust: WorkspaceTrust) => Promise<void>;
  setApprovalMode: (mode: ApprovalMode) => Promise<void>;
  refreshSessions: () => Promise<void>;
  createSession: () => Promise<void>;
  openSession: (path: string) => Promise<void>;
  importSessionFile: () => Promise<void>;
  send: (text: string, images: TransferImage[], behavior: "send" | "steer" | "followUp") => Promise<void>;
  abort: () => Promise<void>;
  selectModel: (provider: string, id: string) => Promise<void>;
  setRuntimeApiKey: (provider: string, apiKey: string) => Promise<boolean>;
  setThinking: (level: string) => Promise<void>;
  compact: () => Promise<void>;
  rollback: (entryId: string) => Promise<void>;
  reloadResources: () => Promise<void>;
  invokeCommand: (command: string) => Promise<void>;
  resolveExtension: (requestId: string, value?: string | boolean, cancelled?: boolean) => Promise<void>;
  saveDiagnostics: () => Promise<void>;
  runDoctor: () => Promise<void>;
  dismissNotice: (id: string) => void;
  setContextVisible: (visible: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setDoctorDialogOpen: (open: boolean) => void;
  setCredentialDialogOpen: (open: boolean) => void;
  setUpdateDialogOpen: (open: boolean) => void;
}

const initialRuntime: RuntimeStatus = {
  phase: "idle",
  detail: "等待选择工作区",
  recoverable: true
};

export const useAppStore = create<AppState>((set, get) => ({
  connected: false,
  runtime: initialRuntime,
  trust: "unknown",
  approvalMode: "guided",
  sessions: [],
  snapshot: undefined,
  liveText: "",
  liveThinking: "",
  extensionRequests: [],
  extensionStatuses: {},
  extensionWidgets: {},
  notices: [],
  doctorReport: undefined,
  doctorRunning: false,
  doctorError: undefined,
  doctorDialogOpen: false,
  credentialDialogOpen: false,
  updateDialogOpen: false,
  contextVisible: true,
  commandPaletteOpen: false,

  setClient(client) {
    get().client?.dispose();
    client.onEvent((event) => handleEvent(event, set));
    set({ client, connected: true });
    const state = get();
    if (!state.workspace) return;
    set({ runtime: { phase: "recovering", detail: "正在恢复 Pi 会话", recoverable: true } });
    void client.request<"runtime.initialize", SessionSnapshot>("runtime.initialize", {
      cwd: state.workspace,
      ...(state.snapshot?.sessionPath === undefined ? {} : { sessionPath: state.snapshot.sessionPath }),
      trust: state.trust,
      approvalMode: state.approvalMode
    }).then((snapshot) => {
      set({ snapshot, runtime: { phase: "ready", detail: "Pi 会话已恢复", recoverable: true } });
    }).catch((error: unknown) => reportError(error, set, "无法恢复 Pi 会话"));
  },

  async openWorkspace() {
    const workspace = await window.pi67.system.selectWorkspace();
    if (!workspace) return;
    set({
      workspace,
      trust: "unknown",
      approvalMode: "guided",
      runtime: { phase: "starting", detail: "正在加载 Pi SDK", recoverable: true },
      snapshot: undefined,
      sessions: []
    });
    try {
      const client = await ensureAgentClient(get);
      const snapshot = await client.request<"runtime.initialize", SessionSnapshot>("runtime.initialize", {
        cwd: workspace,
        trust: "unknown",
        approvalMode: "guided"
      });
      set({ snapshot, runtime: { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true } });
      await get().refreshSessions();
    } catch (error) {
      reportError(error, set, "无法打开工作区");
    }
  },

  async setTrust(trust) {
    const client = requireClient(get());
    try {
      const snapshot = await client.request<"workspace.setTrust", SessionSnapshot>("workspace.setTrust", {
        trust,
        approvalMode: get().approvalMode
      });
      set({ trust, snapshot });
      if (trust === "trusted") await get().reloadResources();
    } catch (error) {
      reportError(error, set, "无法更新工作区信任");
    }
  },

  async setApprovalMode(approvalMode) {
    const client = requireClient(get());
    const snapshot = await client.request<"workspace.setTrust", SessionSnapshot>("workspace.setTrust", {
      trust: get().trust,
      approvalMode
    });
    set({ approvalMode, snapshot });
  },

  async refreshSessions() {
    const sessions = await requireClient(get()).request<"session.list", SessionSummary[]>("session.list", {});
    set({ sessions });
  },

  async createSession() {
    const workspace = get().workspace;
    if (!workspace) return;
    const snapshot = await requireClient(get()).request<"session.create", SessionSnapshot>("session.create", { cwd: workspace });
    set({ snapshot, liveText: "", liveThinking: "" });
    await get().refreshSessions();
  },

  async openSession(path) {
    try {
      const workspace = get().workspace;
      const snapshot = await requireClient(get()).request<"session.open", SessionSnapshot>("session.open", {
        path,
        ...(workspace ? { cwdOverride: workspace } : {})
      });
      set({ snapshot, liveText: "", liveThinking: "" });
    } catch (error) {
      reportError(error, set, "无法恢复 Pi 会话");
    }
  },

  async importSessionFile() {
    const path = await window.pi67.system.selectSessionFile();
    if (!path) return;
    try {
      const snapshot = await requireClient(get()).request<"session.import", SessionSnapshot>("session.import", { path });
      set({ snapshot, liveText: "", liveThinking: "" });
      await get().refreshSessions();
    } catch (error) {
      reportError(error, set, "无法导入 Pi 会话");
    }
  },

  async send(text, images, behavior) {
    const client = requireClient(get());
    const command = behavior === "steer" ? "prompt.steer" : behavior === "followUp" ? "prompt.followUp" : "prompt.send";
    const transfer = images.map((image) => image.data);
    set((state) => ({ snapshot: state.snapshot ? { ...state.snapshot, streaming: true } : state.snapshot }));
    try {
      await client.request(command, { text, images }, transfer);
    } catch (error) {
      reportError(error, set, "Pi 未能接收消息");
    }
  },

  async abort() {
    await requireClient(get()).request("turn.abort", {});
  },

  async selectModel(provider, id) {
    const snapshot = await requireClient(get()).request<"model.select", SessionSnapshot>("model.select", { provider, id });
    set({ snapshot });
  },

  async setRuntimeApiKey(provider, apiKey) {
    try {
      const snapshot = await requireClient(get()).request<"model.setRuntimeKey", SessionSnapshot>("model.setRuntimeKey", {
        provider,
        apiKey
      });
      set({ snapshot, credentialDialogOpen: false });
      addNotice(set, "info", `${provider} API key 已在本次运行中启用；退出后不会保留。`);
      return true;
    } catch (error) {
      reportActionError(error, set, "无法启用 Provider API key");
      return false;
    }
  },

  async setThinking(level) {
    const snapshot = await requireClient(get()).request<"thinking.set", SessionSnapshot>("thinking.set", { level });
    set({ snapshot });
  },

  async compact() {
    const snapshot = await requireClient(get()).request<"session.compact", SessionSnapshot>("session.compact", {});
    set({ snapshot });
  },

  async rollback(entryId) {
    const snapshot = await requireClient(get()).request<"session.rollback", SessionSnapshot>("session.rollback", { entryId });
    set({ snapshot, liveText: "", liveThinking: "" });
  },

  async reloadResources() {
    const snapshot = await requireClient(get()).request<"resource.reload", SessionSnapshot>("resource.reload", {});
    set({ snapshot });
  },

  async invokeCommand(command) {
    await requireClient(get()).request("command.invoke", { command });
    set({ commandPaletteOpen: false });
  },

  async resolveExtension(requestId, value, cancelled) {
    await requireClient(get()).request("extension.ui.respond", {
      requestId,
      ...(value === undefined ? {} : { value }),
      ...(cancelled === undefined ? {} : { cancelled })
    });
    set((state) => ({ extensionRequests: state.extensionRequests.filter((request) => request.requestId !== requestId) }));
  },

  async saveDiagnostics() {
    const diagnostics = await requireClient(get()).request<"diagnostics.collect", Record<string, unknown>>(
      "diagnostics.collect",
      {}
    );
    const path = await window.pi67.system.saveDiagnostics(JSON.stringify(diagnostics, null, 2));
    if (path) addNotice(set, "info", `脱敏诊断已保存：${path}`);
  },

  async runDoctor() {
    set({ doctorDialogOpen: true, doctorReport: undefined, doctorRunning: true, doctorError: undefined });
    try {
      const doctorReport = await (await ensureAgentClient(get)).request<"doctor.run", DoctorReport>("doctor.run", {});
      set({ doctorReport, doctorRunning: false });
    } catch (error) {
      const doctorError = errorMessage(error);
      set({ doctorRunning: false, doctorError });
      reportActionError(error, set, "Windows/macOS Doctor 检查失败");
    }
  },

  dismissNotice(id) {
    set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) }));
  },

  setContextVisible(contextVisible) {
    set({ contextVisible });
  },

  setCommandPaletteOpen(commandPaletteOpen) {
    set({ commandPaletteOpen });
  },

  setDoctorDialogOpen(doctorDialogOpen) {
    set({ doctorDialogOpen });
  },

  setCredentialDialogOpen(credentialDialogOpen) {
    set({ credentialDialogOpen });
  },

  setUpdateDialogOpen(updateDialogOpen) {
    set({ updateDialogOpen });
  }
}));

type StoreSet = typeof useAppStore.setState;

async function ensureAgentClient(get: () => AppState): Promise<AgentPortClient> {
  const existingClient = get().client;
  if (existingClient) return existingClient;
  await window.pi67.system.connectAgentHost();
  const connectedClient = get().client;
  if (connectedClient) return connectedClient;

  return new Promise<AgentPortClient>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for the Agent Host connection."));
    }, 15_000);
    const finish = (client: AgentPortClient) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(client);
    };
    unsubscribe = useAppStore.subscribe((state) => {
      if (state.client) finish(state.client);
    });
    const currentClient = get().client;
    if (currentClient) finish(currentClient);
  });
}

function handleEvent(event: AgentEvent, set: StoreSet): void {
  switch (event.type) {
    case "runtime.statusChanged":
      set({ runtime: event.payload });
      break;
    case "runtime.ready":
      set({ snapshot: event.payload.snapshot, runtime: { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true } });
      break;
    case "runtime.crashed":
      set({ runtime: { phase: "failed", detail: event.payload.detail, recoverable: event.payload.recoverable } });
      break;
    case "session.snapshot":
      set({ snapshot: event.payload, liveText: "", liveThinking: "" });
      break;
    case "session.listed":
      set({ sessions: event.payload.sessions });
      break;
    case "session.delta":
      if (event.payload.eventType === "agent_start") {
        set({ liveText: "", liveThinking: "" });
      }
      break;
    case "turn.streamBatch":
      applyStreamBatch(event.payload.events, set);
      break;
    case "turn.failed":
      addNotice(set, "error", event.payload.message);
      break;
    case "approval.requested":
    case "extension.ui.requested":
      set((state) => ({ extensionRequests: [...state.extensionRequests, event.payload] }));
      break;
    case "extension.ui.updated":
      applyExtensionUpdate(event.payload, set);
      break;
    case "extension.compatibilityChanged":
      set((state) => ({
        extensionStatuses: { ...state.extensionStatuses, [event.payload.extensionId]: event.payload.detail }
      }));
      if (event.payload.status !== "partial") addNotice(set, "warning", event.payload.detail);
      break;
    case "session.externalChangeDetected":
      addNotice(set, "warning", "该 Pi 会话已被外部进程修改。重新加载后才能继续写入。");
      break;
    case "resource.changed":
      addNotice(set, "info", "Pi 资源已重新加载。");
      break;
    case "approval.resolved":
    case "diagnostics.progress":
      break;
    case "doctor.completed":
      set({ doctorReport: event.payload, doctorRunning: false, doctorError: undefined });
      break;
  }
}

function applyStreamBatch(events: unknown[], set: StoreSet): void {
  let text = "";
  let thinking = "";
  for (const value of events) {
    if (typeof value !== "object" || value === null) continue;
    const event = value as Record<string, unknown>;
    const assistant = typeof event.assistantMessageEvent === "object" && event.assistantMessageEvent !== null
      ? event.assistantMessageEvent as Record<string, unknown>
      : undefined;
    if (assistant?.type === "text_delta" && typeof assistant.delta === "string") text += assistant.delta;
    if (assistant?.type === "thinking_delta" && typeof assistant.delta === "string") thinking += assistant.delta;
  }
  if (!text && !thinking) return;
  set((state) => ({
    liveText: state.liveText + text,
    liveThinking: state.liveThinking + thinking
  }));
}

function applyExtensionUpdate(request: ExtensionUiRequestView, set: StoreSet): void {
  if (request.kind === "notify" && request.message) {
    addNotice(set, request.level ?? "info", request.message);
    return;
  }
  if (request.kind === "status" && request.key) {
    set((state) => ({ extensionStatuses: { ...state.extensionStatuses, [request.key!]: request.message ?? "" } }));
    return;
  }
  if (request.kind === "widget" && request.key) {
    set((state) => ({ extensionWidgets: { ...state.extensionWidgets, [request.key!]: request.message ?? "" } }));
    return;
  }
  if (request.kind === "title" && request.message) document.title = `${request.message} - Pi-67 Desktop`;
}

function requireClient(state: AppState): AgentPortClient {
  if (!state.client) throw new Error("Agent Host 尚未连接。");
  return state.client;
}

function reportError(error: unknown, set: StoreSet, context: string): void {
  const detail = errorMessage(error);
  addNotice(set, "error", `${context}：${detail}`);
  set({ runtime: { phase: "failed", detail: `${context}：${detail}`, recoverable: true } });
}

function reportActionError(error: unknown, set: StoreSet, context: string): void {
  addNotice(set, "error", `${context}：${errorMessage(error)}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function addNotice(set: StoreSet, level: UiNotice["level"], message: string): void {
  const notice: UiNotice = { id: `notice-${Date.now()}-${Math.random().toString(36).slice(2)}`, level, message };
  set((state) => ({ notices: [...state.notices.slice(-3), notice] }));
}
