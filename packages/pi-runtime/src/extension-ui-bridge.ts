import type {
  AutocompleteProviderFactory,
  ExtensionUIDialogOptions,
  ExtensionUIContext,
  ExtensionWidgetOptions,
  Theme,
  WorkingIndicatorOptions
} from "@earendil-works/pi-coding-agent";
import type { ExtensionUiRequestView } from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";

interface PendingUiRequest {
  resolve: (value: string | boolean | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
  abort?: () => void;
}

type EditorFactory = ReturnType<ExtensionUIContext["getEditorComponent"]>;

export class DesktopExtensionUiBridge {
  private readonly pending = new Map<string, PendingUiRequest>();
  private sequence = 0;
  private editorText = "";
  private toolsExpanded = false;
  private editorFactory: EditorFactory | undefined;
  private readonly neutralTheme = createNeutralTheme();

  constructor(private readonly emit: (event: AgentEvent) => void) {}

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
    setWorkingMessage: (message) => this.update({
      kind: "working",
      ...(message === undefined ? {} : { message })
    }),
    setWorkingVisible: (visible) => this.update({ kind: "working", message: visible ? "visible" : "hidden" }),
    setWorkingIndicator: (options?: WorkingIndicatorOptions) => {
      const message = options === undefined
        ? "default"
        : options.frames?.length
          ? options.frames.join("")
          : "hidden";
      this.update({ kind: "working", message });
    },
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
      this.update({ kind: "editor-text", message: this.editorText });
    },
    setEditorText: (text) => {
      this.editorText = text;
      this.update({ kind: "editor-text", message: text });
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
    if (!pending) return false;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.abort?.();
    pending.resolve(cancelled ? undefined : value);
    return true;
  }

  dispose(): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.abort?.();
      pending.resolve(undefined);
      this.pending.delete(requestId);
    }
  }

  private request(
    kind: "select" | "confirm" | "input" | "editor",
    details: Pick<ExtensionUiRequestView, "title" | "message" | "placeholder" | "options">,
    opts?: ExtensionUIDialogOptions
  ): Promise<string | boolean | undefined> {
    const requestId = `extension-ui-${Date.now().toString(36)}-${++this.sequence}`;
    const timeout = Math.max(1_000, Math.min(opts?.timeout ?? 300_000, 300_000));
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.resolve(requestId, undefined, true), timeout);
      const abortListener = () => this.resolve(requestId, undefined, true);
      opts?.signal?.addEventListener("abort", abortListener, { once: true });
      this.pending.set(requestId, {
        resolve,
        timer,
        ...(opts?.signal ? { abort: () => opts.signal?.removeEventListener("abort", abortListener) } : {})
      });
      this.emit({
        type: kind === "confirm" ? "approval.requested" : "extension.ui.requested",
        payload: {
          requestId,
          extensionId: "pi-extension",
          kind,
          ...compactDetails(details),
          blocking: true
        }
      });
    });
  }

  private update(details: Omit<ExtensionUiRequestView, "requestId" | "extensionId" | "blocking">): void {
    this.emit({
      type: "extension.ui.updated",
      payload: {
        requestId: `extension-update-${Date.now().toString(36)}-${++this.sequence}`,
        extensionId: "pi-extension",
        ...details,
        blocking: false
      }
    });
  }

  private unsupported(extensionId: string, detail: string): void {
    this.emit({ type: "extension.compatibilityChanged", payload: { extensionId, status: "tui-only", detail } });
    this.update({ kind: "unsupported", message: detail, level: "warning" });
  }
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
