import type {
  ApprovalMode,
  OperationView,
  RuntimeStatus,
  WorkspaceTrust
} from "@pi67/domain";
import type {
  AgentConnectionIdentity,
  AgentEvent,
  DesktopAgentHostFailureState,
  EventEnvelope,
  SequenceGap
} from "@pi67/protocol";

export interface AppState {
  connectionIdentity: AgentConnectionIdentity | undefined;
  hostEpoch: number | undefined;
  connected: boolean;
  runtime: RuntimeStatus;
  workspace: string | undefined;
  trust: WorkspaceTrust;
  trustUpdating: boolean;
  sessionTransitionPending: boolean;
  sessionBootstrapTransitionPending: boolean;
  workspaceOpenPending: boolean;
  approvalMode: ApprovalMode;
  operation: OperationView | undefined;
  operationDetail: string | undefined;
  operationProgress: string | undefined;
  handleAgentConnected: (identity: AgentConnectionIdentity) => void;
  handleAgentTeardown: (error: Error) => void;
  handleSequenceGap: (gap: SequenceGap) => void;
  handleAgentHostFailed: (state: DesktopAgentHostFailureState) => void;
  handlePowerResume: () => void;
  receiveAgentEvent: (event: AgentEvent, envelope: EventEnvelope) => boolean;
}
