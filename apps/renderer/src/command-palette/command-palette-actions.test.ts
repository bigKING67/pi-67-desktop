import type { OperationView, SessionSummary } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import {
  buildPaletteActions,
  paletteAvailability,
  type PaletteActionHandlers
} from "./command-palette-actions.js";

const SESSIONS: SessionSummary[] = [
  { fileIdentity: "session-file-current", id: "current", path: "/sessions/current.jsonl", cwd: "/work", name: "Current", nameSource: "explicit", modifiedAt: 2, messageCount: 2 },
  { fileIdentity: "session-file-other", id: "other", path: "/sessions/other.jsonl", cwd: "/work", name: "Other", nameSource: "explicit", modifiedAt: 1, messageCount: 1 }
];

describe("command palette actions", () => {
  it("keeps local settings available while disabling Host actions when disconnected", () => {
    const actions = build(false, undefined);

    expect(byId(actions, "settings:provider").disabled).toBeUndefined();
    expect(byId(actions, "settings:update").disabled).toBeUndefined();
    expect(byId(actions, "settings:doctor")).toMatchObject({ disabled: true, disabledReason: "Pi 运行服务尚未连接" });
    expect(byId(actions, "pi:compact")).toMatchObject({ disabled: true, disabledReason: "Pi 运行服务尚未连接。" });
    expect(byId(actions, "pi:settings").disabled).toBeUndefined();
  });

  it("matches the Host scheduler by disabling turn and exclusive actions during an active operation", () => {
    const actions = build(true, operation());

    expect(byId(actions, "session:session-file-other")).toMatchObject({ disabled: true, disabledReason: "当前任务结束后可用" });
    expect(byId(actions, "extension:inspect")).toMatchObject({ disabled: true, disabledReason: "当前任务结束后可用" });
    expect(byId(actions, "pi:reload")).toMatchObject({ disabled: true, disabledReason: "当前任务结束或停止后可用。" });
    expect(byId(actions, "pi:compact")).toMatchObject({ disabled: true, disabledReason: "当前任务结束或停止后可用。" });
    expect(byId(actions, "settings:doctor").disabled).toBeUndefined();
  });

  it("reserves Pi builtin names for Desktop actions instead of Extension aliases", () => {
    const actions = buildPaletteActions({
      sessions: [],
      extensionCommands: [
        { name: "model", source: "extension" },
        { name: "inspect", source: "extension" }
      ],
      activeSessionFileIdentity: undefined,
      availability: paletteAvailability({
        connected: true,
        sessionReady: true,
        sessionTransitionPending: false,
        operation: undefined
      }),
      desktopActionContext: desktopContext(true, undefined),
      handlers: handlers()
    });

    expect(actions.filter((action) => action.label === "/model")).toHaveLength(1);
    expect(byId(actions, "extension:inspect")).toBeDefined();
    expect(actions.find((action) => action.id === "extension:model")).toBeUndefined();
  });

  it("marks the current Session without making it the enabled selection", () => {
    const actions = build(true, undefined);

    expect(byId(actions, "session:session-file-current")).toMatchObject({ disabled: true, disabledReason: "当前会话" });
    expect(byId(actions, "session:session-file-other").disabled).toBeUndefined();
  });
});

function build(connected: boolean, activeOperation: OperationView | undefined) {
  return buildPaletteActions({
    sessions: SESSIONS,
    extensionCommands: [{ name: "inspect", source: "extension" }],
    activeSessionFileIdentity: "session-file-current",
    availability: paletteAvailability({
      connected,
      sessionReady: connected,
      sessionTransitionPending: false,
      operation: activeOperation
    }),
    desktopActionContext: desktopContext(connected, activeOperation),
    handlers: handlers()
  });
}

function desktopContext(connected: boolean, activeOperation: OperationView | undefined) {
  return {
    connected,
    workspaceAvailable: true,
    sessionReady: connected,
    sessionTransitionPending: false,
    activeOperation: Boolean(activeOperation),
    configuredModels: [{ provider: "openai", id: "gpt", configured: true }]
  };
}

function byId(actions: ReturnType<typeof build>, id: string) {
  const action = actions.find((item) => item.id === id);
  expect(action).toBeDefined();
  return action!;
}

function operation(): OperationView {
  return {
    operationId: "operation-1",
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "current",
    sessionFileIdentity: "session-file-current",
    sessionGeneration: 1,
    startedAt: 1
  };
}

function handlers(): PaletteActionHandlers {
  return {
    openSession: vi.fn(),
    invokeCommand: vi.fn(),
    executeDesktopAction: vi.fn(),
    openProvider: vi.fn(),
    runDoctor: vi.fn(),
    openUpdate: vi.fn(),
    saveDiagnostics: vi.fn()
  };
}
