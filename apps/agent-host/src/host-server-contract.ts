import type {
  PiConfigurationServiceRegistry,
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
import type { LarkAuthManagementPort } from "./lark-auth-management.js";
import type { EnterpriseCredentialBrokerClient } from "./context/enterprise-credential-broker-client.js";

export interface AttachPortOptions {
  expectedOrigin?: string;
  appInstanceId?: string;
  hostInstanceId?: string;
  hostEpoch?: number;
}

export type AgentRuntimeLoader = TaskRuntimeLoader;

export interface AgentHostServerOptions {
  agentDir?: string;
  configurationServices?: PiConfigurationServiceRegistry;
  abortWatchdogMs?: number;
  operationHeartbeatIntervalMs?: number;
  operationReceiptStorageRoot?: string;
  maxQueuedCommands?: number;
  extensionPackageManagementFactory?: ExtensionPackageManagementFactory;
  packageWorker?: PackageWorkerPort;
  contextFileManagementFactory?: ContextFileManagementFactory;
  skillPackManagementFactory?: SkillPackManagementFactory;
  larkAuthManagement?: LarkAuthManagementPort;
  onRuntimePoisoned?: (message: AgentHostRuntimePoisonedMessage) => void;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  sdkVersionLoader?: () => Promise<string>;
  promptAttachments?: PromptAttachmentAccessOwner;
  onRuntimeInitializationObservation?: (observation: RuntimeInitializationObservation) => void;
  sessionWriterLeaseRegistry?: SessionWriterLeaseRegistry;
  modelCatalogRefreshOnStartup?: boolean;
  enterpriseCredentialBroker?: EnterpriseCredentialBrokerClient;
}

export type AgentHostShutdownResult = Omit<AgentHostShutdownCompleteMessage, "type">;
