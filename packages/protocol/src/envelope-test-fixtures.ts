import type { SessionSnapshot } from "@pi67/domain";
import {
  APP_PROTOCOL_CONTEXT,
  type EventEnvelopeContext,
  type TaskProtocolContext
} from "./envelope.js";

export function appEventContext(hostEpoch: number, sequence: number): EventEnvelopeContext {
  return { hostEpoch, sequence, context: APP_PROTOCOL_CONTEXT };
}

export function taskContext(sessionGeneration: number, operationId?: string): TaskProtocolContext {
  return {
    scope: "task",
    workspaceId: "workspace-1",
    taskId: "task-1",
    taskGeneration: 1,
    sessionId: "session-1",
    sessionGeneration,
    ...(operationId === undefined ? {} : { operationId })
  };
}

export function taskEventContext(
  hostEpoch: number,
  sequence: number,
  sessionGeneration: number,
  operationId?: string
): EventEnvelopeContext {
  return {
    hostEpoch,
    sequence,
    context: taskContext(sessionGeneration, operationId),
    taskSequence: sequence
  };
}

export function emptySnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    cwd: "/tmp",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

export function emptyCatalog() {
  return {
    items: [{
      id: "/extensions/example.ts",
      label: "example-extension",
      path: "/extensions/example.ts",
      loadState: "loaded" as const,
      source: {
        path: "/extensions/example.ts",
        source: "example-extension",
        scope: "project" as const,
        origin: "top-level" as const
      },
      assessment: {
        overall: "partial" as const,
        detail: "Bounded catalog fixture.",
        surfaces: [
          { surface: "commands" as const, status: "supported" as const, detail: "One command." },
          { surface: "tools" as const, status: "not-present" as const, detail: "No tools." },
          { surface: "ui-primitives" as const, status: "unknown" as const, detail: "No attribution." },
          { surface: "tui-custom" as const, status: "unknown" as const, detail: "Unassessed." }
        ]
      },
      commandCount: 1,
      toolCount: 0
    }],
    total: 1,
    truncated: false
  };
}
