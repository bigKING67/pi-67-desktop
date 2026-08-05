import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { refreshWorkspaceChanges } from "../changes/workspace-changes-controller.js";
import {
  applyWorkbenchAgentEvent,
  classifyWorkbenchAgentEvent,
  type WorkbenchEventRoute
} from "../workbench/workbench-event-router.js";
import { useAppStore } from "./app-store.js";

export function applyRendererAgentEvent(
  event: AgentEvent,
  envelope: EventEnvelope,
  onProjectedEvent?: (event: AgentEvent, envelope: EventEnvelope) => void
): WorkbenchEventRoute {
  const route = classifyWorkbenchAgentEvent(event, envelope);
  if (route === "stale") return route;
  if (route === "background") {
    applyWorkbenchAgentEvent(event, envelope);
    return route;
  }

  if (!useAppStore.getState().receiveAgentEvent(event, envelope)) return route;
  if (route === "active") applyWorkbenchAgentEvent(event, envelope);
  if (event.type === "runtime.ready" || event.type === "session.bootstrap") {
    void refreshWorkspaceChanges();
  }
  onProjectedEvent?.(event, envelope);
  return route;
}
