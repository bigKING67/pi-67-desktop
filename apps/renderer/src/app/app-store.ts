import type {
  ApprovalMode,
  DoctorReport,
  ExtensionUiRequestView,
  RuntimeStatus,
  SessionSnapshot,
  SessionSummary,
  WorkspaceTrust
} from "@pi67/domain";
import { AgentPortClient, type TransferImage } from "@pi67/protocol";
import { create } from "zustand";
import { addNotice, handleAgentEvent, type UiNotice } from "./app-events.js";

interface AppState {
  client?: AgentPortClient;
  connected: boolean;
  runtime: RuntimeStatus;
  workspace?: string;
  trust: WorkspaceTrust;
  trustUpdating: boolean;
  sessionTransitionPending: boolean;
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
  trustUpdating: false,
  sessionTransitionPending: false,
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
    const previousState = get();
    previousState.client?.dispose();
    client.onEvent((event) => handleAgentEvent(event, set));
    set({ client, connected: true, trustUpdating: false, sessionTransitionPending: false });

    // The first port is awaited by openWorkspace(), which owns initialization.
    // Only a replacement port represents Agent Host recovery.
    if (!previousState.client || !previousState.workspace) return;
    set({
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "正在恢复 Pi 会话", recoverable: true }
    });
    void client.request<"runtime.initialize", SessionSnapshot>("runtime.initialize", {
      cwd: previousState.workspace,
      ...(previousState.snapshot?.sessionPath === undefined ? {} : { sessionPath: previousState.snapshot.sessionPath }),
      trust: previousState.trust,
      approvalMode: previousState.approvalMode
    }).then((snapshot) => {
      set({ snapshot, sessionTransitionPending: false, runtime: { phase: "ready", detail: "Pi 会话已恢复", recoverable: true } });
    }).catch((error: unknown) => {
      set({ sessionTransitionPending: false });
      reportError(error, set, "无法恢复 Pi 会话");
    });
  },

  async openWorkspace() {
    if (get().sessionTransitionPending) return;
    const workspace = await window.pi67.system.selectWorkspace();
    if (!workspace) return;
    set({
      workspace,
      trust: "unknown",
      trustUpdating: false,
      sessionTransitionPending: true,
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
      set({ snapshot, sessionTransitionPending: false, runtime: { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true } });
      await get().refreshSessions();
    } catch (error) {
      set({ sessionTransitionPending: false });
      reportError(error, set, "无法打开工作区");
    }
  },

  async setTrust(trust) {
    const state = get();
    if (state.trustUpdating || state.sessionTransitionPending) return;
    if (!state.snapshot || state.runtime.phase === "starting" || state.runtime.phase === "recovering") {
      addNotice(set, "warning", "Pi 会话尚未就绪；完成加载后才能更新工作区信任。");
      return;
    }

    const client = requireClient(state);
    set({
      trustUpdating: true,
      sessionTransitionPending: true,
      runtime: { phase: "starting", detail: "正在加载 Pi 资源", recoverable: true }
    });
    try {
      let snapshot = await client.request<"workspace.setTrust", SessionSnapshot>("workspace.setTrust", {
        trust,
        approvalMode: state.approvalMode
      });
      if (trust === "trusted") {
        snapshot = await client.request<"resource.reload", SessionSnapshot>("resource.reload", {});
      }
      set({ trust, snapshot, runtime: { phase: "ready", detail: "Pi 资源已就绪", recoverable: true } });
    } catch (error) {
      reportError(error, set, "无法更新工作区信任");
    } finally {
      set({ trustUpdating: false, sessionTransitionPending: false });
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
    await runSessionTransition(get, set, {
      detail: "正在创建 Pi 新会话",
      errorContext: "无法创建 Pi 会话",
      readyDetail: "Pi 新会话已就绪",
      refreshSessions: true,
      request: (client) => client.request<"session.create", SessionSnapshot>("session.create", { cwd: workspace })
    });
  },

  async openSession(path) {
    const workspace = get().workspace;
    await runSessionTransition(get, set, {
      detail: "正在恢复 Pi 会话",
      errorContext: "无法恢复 Pi 会话",
      readyDetail: "Pi 会话已恢复",
      request: (client) => client.request<"session.open", SessionSnapshot>("session.open", {
        path,
        ...(workspace ? { cwdOverride: workspace } : {})
      })
    });
  },

  async importSessionFile() {
    const path = await window.pi67.system.selectSessionFile();
    if (!path) return;
    await runSessionTransition(get, set, {
      detail: "正在导入 Pi 会话",
      errorContext: "无法导入 Pi 会话",
      readyDetail: "Pi 会话已导入",
      refreshSessions: true,
      request: (client) => client.request<"session.import", SessionSnapshot>("session.import", { path })
    });
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
      set({ snapshot });
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
    await runSessionTransition(get, set, {
      detail: "正在重新加载 Pi 资源",
      errorContext: "无法重新加载 Pi 资源",
      readyDetail: "Pi 资源已重新加载",
      request: (client) => client.request<"resource.reload", SessionSnapshot>("resource.reload", {})
    });
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

type StoreSet = typeof useAppStore.setState;

interface SessionTransitionOptions {
  detail: string;
  errorContext: string;
  readyDetail: string;
  refreshSessions?: boolean;
  request: (client: AgentPortClient) => Promise<SessionSnapshot>;
}

async function runSessionTransition(
  get: () => AppState,
  set: StoreSet,
  options: SessionTransitionOptions
): Promise<void> {
  const state = get();
  if (state.sessionTransitionPending) return;
  set({
    sessionTransitionPending: true,
    runtime: { phase: "starting", detail: options.detail, recoverable: true }
  });
  try {
    const snapshot = await options.request(requireClient(get()));
    set({
      snapshot,
      liveText: "",
      liveThinking: "",
      runtime: { phase: "ready", detail: options.readyDetail, recoverable: true }
    });
    if (options.refreshSessions) await get().refreshSessions();
  } catch (error) {
    reportError(error, set, options.errorContext);
  } finally {
    set({ sessionTransitionPending: false });
  }
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
