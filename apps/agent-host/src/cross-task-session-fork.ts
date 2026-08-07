import type { AgentRuntime } from "@pi67/pi-runtime";
import type { AgentCommand } from "@pi67/protocol";
import type {
  HostTaskStateCoordinator,
  TaskHostState
} from "./host-task-state-coordinator.js";
import { HostCommandError } from "./protocol-error.js";

type CrossTaskForkPayload = Extract<
  AgentCommand,
  { type: "session.forkFromTask" }
>["payload"];

export function forkSessionFromTask(
  tasks: HostTaskStateCoordinator,
  targetState: TaskHostState,
  targetRuntime: AgentRuntime,
  payload: CrossTaskForkPayload
): Promise<ReturnType<AgentRuntime["getSnapshot"]>> {
  if (targetState.record.context.taskId === payload.sourceTaskId) {
    return Promise.reject(new HostCommandError(
      "INVALID_PAYLOAD",
      "A new Task fork requires distinct source and target Task authority.",
      false
    ));
  }
  const sourceState = tasks.values().find((candidate) => (
    candidate.record.context.workspaceId === targetState.record.context.workspaceId
    && candidate.record.context.taskId === payload.sourceTaskId
  ));
  if (!sourceState || sourceState.record.closed) {
    return Promise.reject(new HostCommandError(
      "RUNTIME_NOT_READY",
      "The source Task Runtime is not available for forking.",
      true
    ));
  }
  if (sourceState.record.context.taskGeneration !== payload.sourceTaskGeneration) {
    return Promise.reject(new HostCommandError(
      "INVALID_PAYLOAD",
      "The source Task generation is stale.",
      false,
      {
        expectedTaskGeneration: sourceState.record.context.taskGeneration,
        receivedTaskGeneration: payload.sourceTaskGeneration
      }
    ));
  }
  return tasks.requireScheduler(sourceState).runExclusiveIfIdle(async () => {
    const sourceRuntime = sourceState.record.runtime;
    if (!sourceState.record.initialized || !sourceRuntime) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "The source Task Runtime is not initialized.",
        true
      );
    }
    const identity = sourceRuntime.getIdentity();
    if (
      identity.sessionId !== payload.sourceSessionId
      || identity.sessionFileIdentity !== payload.sourceSessionFileIdentity
    ) {
      throw new HostCommandError(
        "STALE_SESSION_IDENTITY",
        "The source Session authority changed before the new Task was created.",
        true,
        {
          sessionIdMatches: identity.sessionId === payload.sourceSessionId,
          sessionFileIdentityMatches:
            identity.sessionFileIdentity === payload.sourceSessionFileIdentity
        }
      );
    }
    if (identity.sessionGeneration !== payload.sourceSessionGeneration) {
      throw new HostCommandError(
        "STALE_SESSION_GENERATION",
        "The source Session authority changed before the new Task was created.",
        true,
        {
          expectedSessionGeneration: identity.sessionGeneration,
          receivedSessionGeneration: payload.sourceSessionGeneration
        }
      );
    }
    if (!identity.sessionPath) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "The source Task has no persisted Pi Session to fork.",
        true
      );
    }
    return targetRuntime.forkSessionFrom(identity.sessionPath, payload.entryId);
  });
}
