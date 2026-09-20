import type { NativeSubagentAdmission } from "./native-subagent-admission.js";
import type { LocalMemoryAccess } from "./local-memory-extension-bridge.js";
import type { PromptAttachmentAccess } from "./prompt-attachment.js";
import type { RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import type { SharedExperienceAccess } from "./shared-experience-tools.js";
import type { SharedSopAccess } from "./shared-sop-tools.js";
import type { PiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";

export interface PiSdkRuntimeOptions {
  teamKnowledgeAccess?: import("./team-knowledge-access.js").TeamKnowledgeAccess;
  authorizeTeamSession?: (scope: import("@pi67/domain").TeamSessionScope, model?: { baseUrl: string; id: string }, signal?: AbortSignal) => Promise<{ identity: import("@pi67/domain").TeamSessionIdentity; assertValid(): void }>;
  localMemory?: LocalMemoryAccess;
  workspaceServices?: PiWorkspaceRuntimeServices;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  promptAttachmentAccess?: PromptAttachmentAccess;
  subagentAdmission?: NativeSubagentAdmission;
  subagentParentKey?: string;
  sharedExperienceAccess?: SharedExperienceAccess;
  sharedSopAccess?: SharedSopAccess;
}
