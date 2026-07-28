import type { OperationView, SessionSummary } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import {
  buildPaletteActions,
  paletteAvailability,
  type PaletteActionHandlers
} from "./command-palette-actions.js";

const SESSIONS: SessionSummary[] = [
  { id: "current", path: "/sessions/current.jsonl", cwd: "/work", name: "Current", modifiedAt: 2, messageCount: 2 },
  { id: "other", path: "/sessions/other.jsonl", cwd: "/work", name: "Other", modifiedAt: 1, messageCount: 1 }
];

describe("command palette actions", () => {
  it("keeps local settings available while disabling Host actions when disconnected", () => {
    const actions = build(false, undefined);

    expect(byId(actions, "settings:provider").disabled).toBeUndefined();
    expect(byId(actions, "settings:update").disabled).toBeUndefined();
    expect(byId(actions, "settings:doctor")).toMatchObject({ disabled: true, disabledReason: "Pi 运行服务尚未连接" });
    expect(byId(actions, "action:compact")).toMatchObject({ disabled: true, disabledReason: "Pi 运行服务尚未连接" });
  });

  it("matches the Host scheduler by disabling turn and exclusive actions during an active operation", () => {
    const actions = build(true, operation());

    expect(byId(actions, "session:/sessions/other.jsonl")).toMatchObject({ disabled: true, disabledReason: "当前任务结束后可用" });
    expect(byId(actions, "extension:inspect")).toMatchObject({ disabled: true, disabledReason: "当前任务结束后可用" });
    expect(byId(actions, "action:reload")).toMatchObject({ disabled: true, disabledReason: "当前任务结束后可用" });
    expect(byId(actions, "action:compact")).toMatchObject({ disabled: true, disabledReason: "当前任务结束后可用" });
    expect(byId(actions, "settings:doctor").disabled).toBeUndefined();
  });

  it("marks the current Session without making it the enabled selection", () => {
    const actions = build(true, undefined);

    expect(byId(actions, "session:/sessions/current.jsonl")).toMatchObject({ disabled: true, disabledReason: "当前会话" });
    expect(byId(actions, "session:/sessions/other.jsonl").disabled).toBeUndefined();
  });
});

function build(connected: boolean, activeOperation: OperationView | undefined) {
  return buildPaletteActions({
    sessions: SESSIONS,
    extensionCommands: [{ name: "inspect" }],
    activeSessionPath: "/sessions/current.jsonl",
    availability: paletteAvailability({
      connected,
      sessionReady: connected,
      sessionTransitionPending: false,
      operation: activeOperation
    }),
    handlers: handlers()
  });
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
    sessionGeneration: 1,
    startedAt: 1
  };
}

function handlers(): PaletteActionHandlers {
  return {
    openSession: vi.fn(),
    invokeCommand: vi.fn(),
    reloadResources: vi.fn(),
    compactSession: vi.fn(),
    openProvider: vi.fn(),
    runDoctor: vi.fn(),
    openUpdate: vi.fn(),
    saveDiagnostics: vi.fn()
  };
}
