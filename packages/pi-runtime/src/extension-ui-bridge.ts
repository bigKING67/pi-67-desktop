import type {
  AutocompleteProviderFactory,
  ExtensionUIDialogOptions,
  ExtensionUIContext,
  ExtensionWidgetOptions,
  Theme,
  WorkingIndicatorOptions
} from "@earendil-works/pi-coding-agent";
import type {
  ApprovalRequestDetails,
  ExtensionUiCancellationReason,
  ExtensionUiRequestView
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import type { DesktopApprovalDecision } from "./safety-extension.js";

interface PendingUiRequestBase {
  resolve: (value: string | boolean | DesktopApprovalDecision | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
  abort?: () => void;
}

type PendingUiRequest =
  | (PendingUiRequestBase & { purpose: "extension" })
  | (PendingUiRequestBase & { purpose: "approval"; toolCallId: string });

type EditorFactory = ReturnType<ExtensionUIContext["getEditorComponent"]>;

export type ExtensionUiRequestContext = Pick<
  ExtensionUiRequestView,
  "extensionId" | "extensionPackage" | "extensionPath" | "sessionId" | "operationId" | "hostEpoch"
>;

export class DesktopExtensionUiBridge {
  private readonly pending = new Map<string, PendingUiRequest>();
  private readonly reportedUnsupportedFeatures = new Set<string>();
  private sequence = 0;
  private editorText = "";
  private toolsExpanded = false;
  private editorFactory: EditorFactory | undefined;
  private readonly neutralTheme = createNeutralTheme();

  constructor(
    private readonly emit: (event: AgentEvent) => void,
    private readonly getRequestContext: () => ExtensionUiRequestContext = () => ({})
  ) {}

  readonly context: ExtensionUIContext = {
    select: async (title, options, opts) => this.request("select", { title, options }, opts) as Promise<string | undefined>,
    confirm: async (title, message, opts) => Boolean(await this.request("confirm", { title, message }, opts)),
    input: async (title, placeholder, opts) => this.request("input", {
      title,
      ...(placeholder === undefined ? {} : { placeholder })
    }, opts) as Promise<string | undefined>,
    editor: async (title, prefill) => this.request("editor", {
      title,
      ...(prefill === undefined ? {} : { message: prefill })
    }) as Promise<string | undefined>,
    notify: (message, level = "info") => this.update({ kind: "notify", message, level }),
    onTerminalInput: () => () => undefined,
    setStatus: (key, message) => this.update({
      kind: "status",
      key,
      ...(message === undefined ? {} : { message })
    }),
    setWorkingMessage: () => this.unsupported(
      "working-indicator",
      "该 extension 的 TUI 工作指示器不会覆盖 Desktop 任务状态。"
    ),
    setWorkingVisible: () => this.unsupported(
      "working-indicator",
      "该 extension 的 TUI 工作指示器不会覆盖 Desktop 任务状态。"
    ),
    setWorkingIndicator: (_options?: WorkingIndicatorOptions) => this.unsupported(
      "working-indicator",
      "该 extension 的 TUI 工作指示器不会覆盖 Desktop 任务状态。"
    ),
    setHiddenThinkingLabel: (message) => this.update({
      kind: "status",
      key: "hidden-thinking",
      ...(message === undefined ? {} : { message })
    }),
    setWidget: (key: string, content: string[] | ((...args: never[]) => unknown) | undefined, options?: ExtensionWidgetOptions) => {
      if (typeof content === "function") {
        this.unsupported("component-widget", "该 extension 使用 TUI component widget，Desktop 无法安全渲染。");
        return;
      }
      this.update({
        kind: "widget",
        key,
        ...(content === undefined ? {} : { message: content.join("\n") }),
        ...(options?.placement === undefined ? {} : { placement: options.placement })
      });
    },
    setFooter: (factory) => {
      if (factory) this.unsupported("custom-footer", "该 extension 使用 TUI footer，Desktop 保留默认状态栏。");
    },
    setHeader: (factory) => {
      if (factory) this.unsupported("custom-header", "该 extension 使用 TUI header，Desktop 保留默认标题区。");
    },
    setTitle: (title) => this.update({ kind: "title", message: title }),
    custom: async () => {
      this.unsupported("custom", "该 extension 依赖 ctx.ui.custom()，只能在 Pi TUI 中使用。");
      throw new DesktopUnsupportedUiError("ctx.ui.custom() is TUI-only.");
    },
    pasteToEditor: (text) => {
      this.editorText += text;
      this.unsupported("editor-mutation", "该 extension 不能直接修改 Desktop composer 草稿。");
    },
    setEditorText: (text) => {
      this.editorText = text;
      this.unsupported("editor-mutation", "该 extension 不能直接修改 Desktop composer 草稿。");
    },
    getEditorText: () => this.editorText,
    addAutocompleteProvider: (_factory: AutocompleteProviderFactory) => {
      this.unsupported("autocomplete", "该 extension 的 TUI autocomplete 不会修改 Desktop composer。");
    },
    setEditorComponent: (factory) => {
      this.editorFactory = factory;
      if (factory) this.unsupported("custom-editor", "该 extension 的 TUI editor component 不会替换 Desktop composer。");
    },
    getEditorComponent: () => this.editorFactory,
    theme: this.neutralTheme,
    getAllThemes: () => [{ name: "pi67-desktop", path: undefined }],
    getTheme: () => this.neutralTheme,
    setTheme: () => ({ success: false, error: "Desktop theme is controlled by the application." }),
    getToolsExpanded: () => this.toolsExpanded,
    setToolsExpanded: (expanded) => {
      this.toolsExpanded = expanded;
    }
  };

  resolve(requestId: string, value?: string | boolean, cancelled = false): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.purpose !== "extension") return false;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.abort?.();
    pending.resolve(cancelled ? undefined : value);
    this.emit({ type: "extension.ui.resolved", payload: { requestId, cancelled } });
    return true;
  }

  resolveApproval(requestId: string, toolCallId: string, allowed: boolean): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.purpose !== "approval" || pending.toolCallId !== toolCallId) return false;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.abort?.();
    pending.resolve({ status: allowed ? "allowed" : "denied" });
    this.emit({ type: "approval.resolved", payload: { requestId, toolCallId, allowed } });
    return true;
  }

  requestApproval(
    details: ApprovalRequestDetails,
    opts?: ExtensionUIDialogOptions
  ): Promise<DesktopApprovalDecision> {
    if (opts?.signal?.aborted) return Promise.resolve({ status: "cancelled", reason: "abort" });
    return this.openRequest("approval", details, opts).then((result) => (
      isApprovalDecision(result)
        ? result
        : { status: "cancelled", reason: "unavailable" }
    ));
  }

  cancelAll(reason: ExtensionUiCancellationReason): string[] {
    const requestIds = [...this.pending.keys()];
    if (requestIds.length === 0) return requestIds;
    const extensionIds: string[] = [];
    const approvalRequests: Array<{ requestId: string; toolCallId: string }> = [];
    for (const [requestId, request] of this.pending) {
      if (request.purpose === "approval") approvalRequests.push({ requestId, toolCallId: request.toolCallId });
      else extensionIds.push(requestId);
    }
    for (const requestId of requestIds) this.settleCancelled(requestId, reason);
    if (extensionIds.length > 0) {
      this.emit({ type: "extension.ui.cancelled", payload: { requestIds: extensionIds, reason } });
    }
    if (approvalRequests.length > 0) {
      this.emit({ type: "approval.cancelled", payload: { requests: approvalRequests, reason } });
    }
    return requestIds;
  }

  dispose(): void {
    this.cancelAll("runtime-dispose");
  }

  private request(
    kind: "select" | "confirm" | "input" | "editor",
    details: Pick<ExtensionUiRequestView, "title" | "message" | "placeholder" | "options">,
    opts?: ExtensionUIDialogOptions
  ): Promise<string | boolean | undefined> {
    return this.openRequest("extension", {
      kind,
      ...compactDetails(details),
      blocking: true
    }, opts);
  }

  private openRequest(
    purpose: "extension",
    details: Pick<ExtensionUiRequestView, "kind" | "title" | "message" | "placeholder" | "options" | "blocking">,
    opts?: ExtensionUIDialogOptions
  ): Promise<string | boolean | undefined>;
  private openRequest(
    purpose: "approval",
    details: ApprovalRequestDetails,
    opts?: ExtensionUIDialogOptions
  ): Promise<DesktopApprovalDecision>;
  private openRequest(
    purpose: "extension" | "approval",
    details: Pick<ExtensionUiRequestView, "kind" | "title" | "message" | "placeholder" | "options" | "blocking">
      | ApprovalRequestDetails,
    opts?: ExtensionUIDialogOptions
  ): Promise<string | boolean | DesktopApprovalDecision | undefined> {
    if (opts?.signal?.aborted) {
      return Promise.resolve(purpose === "approval"
        ? { status: "cancelled", reason: "abort" }
        : undefined);
    }
    const requestId = `${purpose}-ui-${Date.now().toString(36)}-${++this.sequence}`;
    const timeout = Math.max(1_000, Math.min(opts?.timeout ?? 300_000, 300_000));
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.cancel(requestId, "timeout"), timeout);
      const abortListener = () => this.cancel(requestId, "abort");
      opts?.signal?.addEventListener("abort", abortListener, { once: true });
      const pendingBase = {
        resolve,
        timer,
        ...(opts?.signal ? { abort: () => opts.signal?.removeEventListener("abort", abortListener) } : {})
      };
      this.pending.set(requestId, purpose === "approval"
        ? { ...pendingBase, purpose, toolCallId: (details as ApprovalRequestDetails).toolCallId }
        : { ...pendingBase, purpose });
      if (purpose === "approval") {
        this.emit({
          type: "approval.requested",
          payload: { requestId, ...this.requestContext(), ...(details as ApprovalRequestDetails) }
        });
        return;
      }
      this.emit({
        type: "extension.ui.requested",
        payload: {
          requestId,
          ...this.requestContext(),
          ...(details as Pick<ExtensionUiRequestView, "kind" | "title" | "message" | "placeholder" | "options" | "blocking">)
        }
      });
    });
  }

  private update(details: Omit<
    ExtensionUiRequestView,
    | "requestId"
    | "extensionId"
    | "extensionPackage"
    | "extensionPath"
    | "sessionId"
    | "operationId"
    | "hostEpoch"
    | "blocking"
  >): void {
    this.emit({
      type: "extension.ui.updated",
      payload: {
        requestId: `extension-update-${Date.now().toString(36)}-${++this.sequence}`,
        ...this.requestContext(),
        ...details,
        blocking: false
      }
    });
  }

  private unsupported(feature: string, detail: string): void {
    if (this.reportedUnsupportedFeatures.has(feature)) return;
    this.reportedUnsupportedFeatures.add(feature);
    this.emit({
      type: "extension.compatibilityChanged",
      payload: { ...pickExtensionAttribution(this.requestContext()), status: "tui-only", detail: `${feature}: ${detail}` }
    });
  }

  private requestContext(): ExtensionUiRequestContext {
    const context = this.getRequestContext();
    return {
      ...(context.extensionId === undefined ? {} : { extensionId: context.extensionId }),
      ...(context.extensionPackage === undefined ? {} : { extensionPackage: context.extensionPackage }),
      ...(context.extensionPath === undefined ? {} : { extensionPath: context.extensionPath }),
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      ...(context.operationId === undefined ? {} : { operationId: context.operationId }),
      ...(context.hostEpoch === undefined ? {} : { hostEpoch: context.hostEpoch })
    };
  }

  private cancel(requestId: string, reason: Extract<ExtensionUiCancellationReason, "timeout" | "abort">): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    if (!this.settleCancelled(requestId, reason)) return false;
    if (pending.purpose === "approval") {
      this.emit({
        type: "approval.cancelled",
        payload: { requests: [{ requestId, toolCallId: pending.toolCallId }], reason }
      });
    } else {
      this.emit({ type: "extension.ui.cancelled", payload: { requestIds: [requestId], reason } });
    }
    return true;
  }

  private settleCancelled(requestId: string, reason: ExtensionUiCancellationReason): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.abort?.();
    pending.resolve(pending.purpose === "approval"
      ? { status: "cancelled", reason }
      : undefined);
    return true;
  }
}

function isApprovalDecision(value: unknown): value is DesktopApprovalDecision {
  if (typeof value !== "object" || value === null || !("status" in value)) return false;
  if (value.status === "allowed" || value.status === "denied") return true;
  if (value.status !== "cancelled" || !("reason" in value)) return false;
  return [
    "session-transition",
    "resource-reload",
    "runtime-dispose",
    "connection-close",
    "projection-resync",
    "timeout",
    "abort",
    "unavailable"
  ].includes(String(value.reason));
}

export class DesktopUnsupportedUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopUnsupportedUiError";
  }
}

function compactDetails(
  details: Pick<ExtensionUiRequestView, "title" | "message" | "placeholder" | "options">
): Pick<ExtensionUiRequestView, "title" | "message" | "placeholder" | "options"> {
  return {
    ...(details.title === undefined ? {} : { title: details.title }),
    ...(details.message === undefined ? {} : { message: details.message }),
    ...(details.placeholder === undefined ? {} : { placeholder: details.placeholder }),
    ...(details.options === undefined ? {} : { options: details.options })
  };
}

function pickExtensionAttribution(
  context: ExtensionUiRequestContext
): Pick<ExtensionUiRequestView, "extensionId" | "extensionPackage" | "extensionPath"> {
  return {
    ...(context.extensionId === undefined ? {} : { extensionId: context.extensionId }),
    ...(context.extensionPackage === undefined ? {} : { extensionPackage: context.extensionPackage }),
    ...(context.extensionPath === undefined ? {} : { extensionPath: context.extensionPath })
  };
}

function createNeutralTheme(): Theme {
  const identity = (_role: string, text: string) => text;
  return new Proxy({}, {
    get: (_target, property) => {
      if (property === "name") return "pi67-desktop";
      if (property === "getColorMode") return () => "truecolor";
      if (property === "getThinkingBorderColor" || property === "getBashModeBorderColor") return () => (text: string) => text;
      if (property === "fg" || property === "bg") return identity;
      if (["bold", "italic", "underline", "inverse", "strikethrough"].includes(String(property))) return (text: string) => text;
      if (property === "getFgAnsi" || property === "getBgAnsi") return () => "";
      return undefined;
    }
  }) as Theme;
}
