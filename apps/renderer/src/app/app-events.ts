import type {
  DoctorReport,
  ExtensionUiRequestView,
  RuntimeStatus,
  SessionSnapshot,
  SessionSummary
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";

export interface UiNotice {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
}

interface AppEventState {
  runtime: RuntimeStatus;
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
  sessionTransitionPending: boolean;
}

type EventStoreSet<TState extends AppEventState> = (
  partial: Partial<TState> | ((state: TState) => Partial<TState>)
) => void;

export function handleAgentEvent<TState extends AppEventState>(event: AgentEvent, set: EventStoreSet<TState>): void {
  switch (event.type) {
    case "runtime.statusChanged":
      set({ runtime: event.payload } as Partial<TState>);
      break;
    case "runtime.ready":
      set({
        snapshot: event.payload.snapshot,
        sessionTransitionPending: false,
        runtime: { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true }
      } as Partial<TState>);
      break;
    case "runtime.crashed":
      set({
        sessionTransitionPending: false,
        runtime: { phase: "failed", detail: event.payload.detail, recoverable: event.payload.recoverable }
      } as Partial<TState>);
      break;
    case "session.snapshot":
      set({ snapshot: event.payload, liveText: "", liveThinking: "" } as Partial<TState>);
      break;
    case "session.listed":
      set({ sessions: event.payload.sessions } as Partial<TState>);
      break;
    case "session.delta":
      if (event.payload.eventType === "agent_start") {
        set({ liveText: "", liveThinking: "" } as Partial<TState>);
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
      set((state) => ({ extensionRequests: [...state.extensionRequests, event.payload] }) as Partial<TState>);
      break;
    case "extension.ui.updated":
      applyExtensionUpdate(event.payload, set);
      break;
    case "extension.compatibilityChanged":
      set((state) => ({
        extensionStatuses: { ...state.extensionStatuses, [event.payload.extensionId]: event.payload.detail }
      }) as Partial<TState>);
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
      set({ doctorReport: event.payload, doctorRunning: false, doctorError: undefined } as Partial<TState>);
      break;
  }
}

export function addNotice<TState extends AppEventState>(
  set: EventStoreSet<TState>,
  level: UiNotice["level"],
  message: string
): void {
  set((state) => {
    if (state.notices.some((notice) => notice.level === level && notice.message === message)) return {} as Partial<TState>;
    const notice: UiNotice = { id: `notice-${Date.now()}-${Math.random().toString(36).slice(2)}`, level, message };
    return { notices: [...state.notices.slice(-3), notice] } as Partial<TState>;
  });
}

function applyStreamBatch<TState extends AppEventState>(events: unknown[], set: EventStoreSet<TState>): void {
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
  }) as Partial<TState>);
}

function applyExtensionUpdate<TState extends AppEventState>(request: ExtensionUiRequestView, set: EventStoreSet<TState>): void {
  if (request.kind === "notify" && request.message) {
    addNotice(set, request.level ?? "info", request.message);
    return;
  }
  if (request.kind === "status" && request.key) {
    set((state) => ({ extensionStatuses: { ...state.extensionStatuses, [request.key!]: request.message ?? "" } }) as Partial<TState>);
    return;
  }
  if (request.kind === "widget" && request.key) {
    set((state) => ({ extensionWidgets: { ...state.extensionWidgets, [request.key!]: request.message ?? "" } }) as Partial<TState>);
    return;
  }
  if (request.kind === "title" && request.message) document.title = `${request.message} - Pi-67 Desktop`;
}
