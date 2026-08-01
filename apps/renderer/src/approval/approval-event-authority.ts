import type { ApprovalRequestView } from "@pi67/domain";
import type { EventEnvelope } from "@pi67/protocol";
import {
  hasCurrentInteractiveSessionAuthority,
  matchesInteractiveEnvelope,
  type InteractiveAuthorityState
} from "../connection/interactive-authority.js";

export interface ApprovalTerminalIdentity {
  requestId: string;
  toolCallId: string;
}

export function currentApprovalTerminalRequestIds(
  state: InteractiveAuthorityState,
  requests: ApprovalRequestView[],
  terminals: ApprovalTerminalIdentity[],
  envelope: EventEnvelope
): string[] {
  const toolCallByRequestId = new Map(terminals.map((terminal) => [terminal.requestId, terminal.toolCallId]));
  return requests
    .filter((request) => (
      toolCallByRequestId.get(request.requestId) === request.toolCallId
      && hasCurrentInteractiveSessionAuthority(state, request)
      && matchesInteractiveEnvelope(request, envelope)
    ))
    .map((request) => request.requestId);
}
