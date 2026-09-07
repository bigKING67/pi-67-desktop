import type { SessionSummary } from "@pi67/domain";
import { vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { rendererWorkbenchStore, type RendererWorkbenchTask } from "../workbench/workbench-store.js";

export function openUnconfirmedTask(overrides: Partial<RendererWorkbenchTask> = {}): void {
  rendererWorkbenchStore.getState().openTask(unconfirmedTask(overrides));
}

export function unconfirmedTask(overrides: Partial<RendererWorkbenchTask> = {}): RendererWorkbenchTask {
  return {
    id: "task-unconfirmed",
    conversation: {
      kind: "provisional",
      workspaceId: "workspace-a",
      draftId: "task-unconfirmed"
    },
    workspaceId: "workspace-a",
    sessionId: "pending:task-unconfirmed",
    taskGeneration: 1,
    lifecycle: "draft",
    runtime: { phase: "failed", detail: "unknown", recoverable: true },
    title: "未命名对话",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0,
    creationId: "session-creation-unconfirmed",
    creationStatus: "unconfirmed",
    ...overrides
  };
}

export function catalogSession(
  id: string,
  modifiedAt: number,
  overrides: Partial<SessionSummary> = {}
): SessionSummary {
  return {
    fileIdentity: `session-file-fixture-${id}`,
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/work/a",
    name: "未命名对话",
    nameSource: "fallback",
    modifiedAt,
    messageCount: 0,
    ...overrides
  };
}

export function mockMaterializedResolution(): void {
  const created = catalogSession("session-created", 10_100);
  vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
    if (type === "session.creation.resolve") {
      return {
        status: "materialized",
        creationId: "session-creation-unconfirmed",
        sessionId: created.id,
        sessionFileIdentity: created.fileIdentity,
        sessionPath: created.path
      } as never;
    }
    throw new Error(`Unexpected request: ${type}`);
  });
}

export function openExistingOwner(
  session: SessionSummary,
  overrides: Partial<RendererWorkbenchTask> = {}
): void {
  rendererWorkbenchStore.getState().openTask({
    ...unconfirmedTask(),
    id: "task-existing-owner",
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity: session.fileIdentity,
      sessionPath: session.path
    },
    sessionId: session.id,
    sessionFileIdentity: session.fileIdentity,
    sessionPath: session.path,
    lifecycle: "stopped",
    runtime: { phase: "stopped", detail: "stopped", recoverable: true },
    creationId: undefined,
    creationStatus: undefined,
    ...overrides
  });
}

export function workspace() {
  return {
    id: "workspace-a",
    displayName: "A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" as const },
    trust: "trusted" as const,
    trustProvenance: "native-picker" as const,
    availability: "available" as const
  };
}
