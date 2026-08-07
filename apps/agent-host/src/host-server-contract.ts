import type {
  RuntimeCredentialOverrideStore,
  RuntimeInitializationObservation
} from "@pi67/pi-runtime";
import type {
  AgentHostRuntimePoisonedMessage,
  AgentHostShutdownCompleteMessage
} from "@pi67/protocol";
import type {
  ContextFileManagementFactory,
  ExtensionPackageManagementFactory,
  SkillPackManagementFactory
} from "./resource-management-routers.js";
import type { TaskRuntimeLoader } from "./task-runtime-registry.js";
import type { PromptAttachmentAccessOwner } from "./prompt-attachment-access.js";
import type { PackageWorkerPort } from "./package-worker-client.js";
import type { SessionWriterLeaseRegistry } from "./session-writer-lease-registry.js";

export interface AttachPortOptions {
  expectedOrigin?: string;
  appInstanceId?: string;
  hostInstanceId?: string;
  hostEpoch?: number;
}

export type AgentRuntimeLoader = TaskRuntimeLoader;

export interface AgentHostServerOptions {
  abortWatchdogMs?: number;
  operationHeartbeatIntervalMs?: number;
  operationReceiptStorageRoot?: string;
  maxQueuedCommands?: number;
  extensionPackageManagementFactory?: ExtensionPackageManagementFactory;
  packageWorker?: PackageWorkerPort;
  contextFileManagementFactory?: ContextFileManagementFactory;
  skillPackManagementFactory?: SkillPackManagementFactory;
  onRuntimePoisoned?: (message: AgentHostRuntimePoisonedMessage) => void;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  sdkVersionLoader?: () => Promise<string>;
  promptAttachments?: PromptAttachmentAccessOwner;
  onRuntimeInitializationObservation?: (observation: RuntimeInitializationObservation) => void;
  sessionWriterLeaseRegistry?: SessionWriterLeaseRegistry;
}

export type AgentHostShutdownResult = Omit<AgentHostShutdownCompleteMessage, "type">;
