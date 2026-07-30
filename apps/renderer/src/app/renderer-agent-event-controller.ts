import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import {
  routeWorkbenchAgentEvent,
  type WorkbenchEventRoute
} from "../workbench/workbench-event-router.js";
import { useAppStore } from "./app-store.js";

export function applyRendererAgentEvent(
  event: AgentEvent,
  envelope: EventEnvelope,
  onProjectedEvent?: (event: AgentEvent, envelope: EventEnvelope) => void
): WorkbenchEventRoute {
  const route = routeWorkbenchAgentEvent(event, envelope);
  if (route === "background" || route === "stale") return route;

  useAppStore.getState().receiveAgentEvent(event, envelope);
  onProjectedEvent?.(event, envelope);
  return route;
}
